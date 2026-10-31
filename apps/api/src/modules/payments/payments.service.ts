import { Inject, Injectable } from '@nestjs/common';
import {
  listPaymentsSchema,
  recordPaymentSchema,
  replacePaymentScheduleSchema,
} from '@tahi/shared';
import { z } from 'zod';
import { AuditService } from '../../common/auth/audit.service';
import { can } from '../../common/auth/permissions';
import { ApiException } from '../../common/http/api-exception';
import { fromDbDate, toDbDate } from '../../common/http/dates';
import { Paginated } from '../../common/http/paginated';
import type { ScopedPrisma } from '../../common/prisma/prisma-clients';
import { SCOPED_PRISMA } from '../../common/prisma/scoped-prisma.token';
import { RequestContext } from '../../common/request-context/request-context';
import { ClientsService } from '../clients/clients.service';
import { MediaService } from '../media/media.service';
import { ProjectsService } from '../projects/projects.service';

const notFound = () => new ApiException(404, 'NOT_FOUND', 'Payment not found');
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const PERSON = { select: { email: true, fullName: true } } as const;
const DETAIL = {
  omit: { idempotencyKey: true },
  include: {
    recordedBy: PERSON,
    voidedBy: PERSON,
    project: {
      select: {
        id: true,
        projectNumber: true,
        title: true,
        client: { select: { fullName: true } },
      },
    },
    scheduleItem: { select: { label: true } },
  },
} as const;

interface Movement {
  kind: 'payment' | 'refund';
  amountCentavos: number;
  voidedAt: Date | null;
}

/** Price minus payments plus refunds, ignoring voided rows. Negative means overpaid. */
export function deriveBalance(priceCentavos: number, movements: Movement[]) {
  const sum = (kind: Movement['kind']) =>
    movements
      .filter((m) => m.kind === kind && !m.voidedAt)
      .reduce((total, m) => total + m.amountCentavos, 0);
  const paidCentavos = sum('payment');
  const refundedCentavos = sum('refund');
  return {
    priceCentavos,
    paidCentavos,
    refundedCentavos,
    balanceCentavos: priceCentavos - paidCentavos + refundedCentavos,
  };
}

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrisma,
    private readonly projects: ProjectsService,
    private readonly clients: ClientsService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly context: RequestContext,
  ) {}

  /** The difference is a warning for the designer, not a rule: prices change during a project. */
  async getSchedule(projectId: string) {
    const { priceCentavos } = await this.projects.get(projectId);
    const items = await this.db.paymentScheduleItem.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
    });
    const totalCentavos = items.reduce((sum, item) => sum + item.amountCentavos, 0);
    return {
      items: items.map((item) => ({ ...item, dueDate: fromDbDate(item.dueDate) })),
      totalCentavos,
      priceCentavos,
      differenceCentavos: priceCentavos - totalCentavos,
    };
  }

  /** Items sent with an id are kept and the rest are replaced. */
  async replaceSchedule(
    projectId: string,
    { items }: z.output<typeof replacePaymentScheduleSchema>,
  ) {
    await this.projects.assertActive(projectId);
    await this.db.$transaction(async (tx) => {
      const keep = items.flatMap((item) => (item.id ? [item.id] : []));
      await tx.paymentScheduleItem.deleteMany({ where: { projectId, id: { notIn: keep } } });
      for (const [sortOrder, { id, dueDate, ...data }] of items.entries()) {
        const fields = { ...data, sortOrder, dueDate: toDbDate(dueDate)! };
        if (id) {
          const { count } = await tx.paymentScheduleItem.updateMany({
            where: { id, projectId },
            data: fields,
          });
          if (count === 0) throw new ApiException(404, 'NOT_FOUND', 'Schedule item not found');
        } else {
          await tx.paymentScheduleItem.create({ data: { ...fields, projectId } as never });
        }
      }
    });
    return this.getSchedule(projectId);
  }

  async listForProject(projectId: string) {
    const { priceCentavos } = await this.projects.get(projectId);
    const items = await this.db.payment.findMany({
      ...DETAIL,
      where: { projectId },
      orderBy: { paidAt: 'desc' },
    });
    return { items, ...deriveBalance(priceCentavos, items) };
  }

  async listForClient(clientId: string) {
    await this.clients.get(clientId);
    return this.db.payment.findMany({
      ...DETAIL,
      where: { project: { is: { clientId } } },
      orderBy: { paidAt: 'desc' },
    });
  }

  /** Tenant-wide, for owners and admins. Days are Manila calendar days. */
  async list({ page, limit, from, to }: z.output<typeof listPaymentsSchema>) {
    const where = {
      ...(from || to
        ? {
            paidAt: {
              ...(from ? { gte: new Date(`${from}T00:00:00.000+08:00`) } : {}),
              ...(to ? { lte: new Date(`${to}T23:59:59.999+08:00`) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.payment.findMany({
        ...DETAIL,
        where,
        orderBy: { paidAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.payment.count({ where }),
    ]);
    return new Paginated(items, { page, limit }, total);
  }

  /** A retry with the same key returns the first result instead of recording money twice. */
  async record(
    projectId: string,
    idempotencyKey: string,
    { paidAt, ...input }: z.output<typeof recordPaymentSchema>,
  ) {
    if (input.kind === 'refund' && !can(this.context.role!, 'payments:refund')) {
      throw new ApiException(403, 'FORBIDDEN', 'Your role does not allow this');
    }
    const replay = async () => {
      const first = await this.db.payment.findFirst({
        where: { idempotencyKey },
        include: DETAIL.include,
        omit: DETAIL.omit,
      });
      if (!first) return null;
      const same =
        first.projectId === projectId &&
        first.kind === input.kind &&
        first.amountCentavos === input.amountCentavos &&
        first.method === input.method;
      if (!same) {
        throw new ApiException(
          409,
          'CONFLICT',
          'This request key was used for a different payment',
        );
      }
      return first;
    };

    const earlier = await replay();
    if (earlier) return earlier;

    await this.projects.assertActive(projectId);
    const moment = new Date(paidAt);
    if (moment.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', 'The payment date is in the future');
    }
    if (input.scheduleItemId) {
      const item = await this.db.paymentScheduleItem.findFirst({
        where: { id: input.scheduleItemId, projectId },
      });
      if (!item) throw new ApiException(404, 'NOT_FOUND', 'Schedule item not found');
    }
    if (input.proofMediaId)
      await this.media.assertAttachable(input.proofMediaId, ['payment_proof']);

    try {
      return await this.db.payment.create({
        ...DETAIL,
        data: {
          ...input,
          projectId,
          idempotencyKey,
          paidAt: moment,
          recordedByUserId: this.context.principal!.userId,
        } as never,
      });
    } catch (error) {
      // Two simultaneous retries: the loser returns what the winner recorded.
      if ((error as { code?: string }).code === 'P2002') {
        const winner = await replay();
        if (winner) return winner;
      }
      throw error;
    }
  }

  async voidPayment(id: string, reason: string) {
    const payment = await this.db.payment.findUnique({ where: { id } });
    if (!payment) throw notFound();
    // Conditional, so two people voiding at once can't overwrite each other's reason.
    const { count } = await this.db.payment.updateMany({
      where: { id, voidedAt: null },
      data: {
        voidedAt: new Date(),
        voidedByUserId: this.context.principal!.userId,
        voidReason: reason,
      },
    });
    if (count === 0) throw new ApiException(409, 'CONFLICT', 'This payment is already voided');
    await this.audit.record({
      action: 'payment.voided',
      entityType: 'payment',
      entityId: id,
      metadata: {
        kind: payment.kind,
        amountCentavos: payment.amountCentavos,
        projectId: payment.projectId,
        reason,
      },
    });
    return this.db.payment.findUniqueOrThrow({ ...DETAIL, where: { id } });
  }

  /** For reports: every counted movement in a range of moments. */
  countedBetween(paidAt: { gte: Date; lt: Date }) {
    return this.db.payment.findMany({
      where: { voidedAt: null, paidAt },
      select: { kind: true, amountCentavos: true, paidAt: true },
    });
  }

  /** For reports: every counted movement on these projects. */
  countedForProjects(projectIds: string[]) {
    return this.db.payment.findMany({
      where: { voidedAt: null, projectId: { in: projectIds } },
      select: { projectId: true, kind: true, amountCentavos: true, voidedAt: true },
    });
  }
}
