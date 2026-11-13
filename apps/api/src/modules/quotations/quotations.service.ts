import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, type TenantDatabase } from '@tahi/database';
import type {
  CreateQuotationRequest,
  QuotationListQuery,
  UpdateQuotationRequest,
} from '@tahi/validation';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../core/audit/audit.service.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { afterCursor, decodeCursor, encodeCursor } from '../../core/http/cursor.js';
import { DomainError, NotFoundError, ValidationFailedError } from '../../core/http/domain-error.js';
import { Paginated } from '../../core/http/envelope.interceptor.js';
import { CounterService, yearIn } from '../../core/numbering/counter.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { TenantSettingsService } from '../tenants/tenant-settings.service.js';
import {
  LinePricingService,
  type BuiltLines,
  type OptionSnapshot,
} from './line-pricing.service.js';

type Status = Prisma.QuotationGetPayload<object>['status'];

/** YYYY-MM-DD today in an IANA time zone (en-CA formats dates as ISO). */
export const todayIn = (timezone: string, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
export const asDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const INCLUDE = {
  client: { select: { id: true, firstName: true, lastName: true } },
  items: { orderBy: { sortOrder: 'asc' } },
} as const satisfies Prisma.QuotationInclude;
type Row = Prisma.QuotationGetPayload<{ include: typeof INCLUDE }>;

function toQuotation(q: Row) {
  const m = (d: Prisma.Decimal) => ({ amount: d.toFixed(2), currency: q.currency });
  return {
    id: q.id,
    number: q.number,
    revision: q.revision,
    supersedesId: q.supersedesId,
    client: {
      id: q.client.id,
      name: [q.client.firstName, q.client.lastName].filter(Boolean).join(' '),
    },
    status: q.status,
    validUntil: q.validUntil ? isoDate(q.validUntil) : null,
    subtotal: m(q.subtotal),
    discount: m(q.discount),
    tax: m(q.tax),
    total: m(q.total),
    taxRate: q.taxRate.toFixed(2),
    pricesIncludeTax: q.pricesIncludeTax,
    notes: q.notes,
    version: q.version,
    sentAt: q.sentAt?.toISOString() ?? null,
    decidedAt: q.decidedAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
    items: q.items.map((i) => ({
      id: i.id,
      catalogItemId: i.catalogItemId,
      name: i.name,
      description: i.description,
      unitPrice: m(i.unitPrice),
      quantity: i.quantity,
      options: (i.options as unknown as OptionSnapshot[]).map((o) => ({
        ...o,
        priceDelta: { amount: o.priceDelta, currency: q.currency },
      })),
      lineTotal: m(i.lineTotal),
      measurementRecordId: i.measurementRecordId,
    })),
  };
}

const conflict = (code: string, message: string) =>
  new DomainError(code, message, HttpStatus.CONFLICT);
const invalidStatus = (action: string, status: Status) =>
  conflict('INVALID_QUOTATION_STATUS', `Cannot ${action} a quotation that is ${status}.`);

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Quotations: drafts, revisions, sending, decisions and expiry (ADR-033). */
@Injectable()
export class QuotationsService {
  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly settings: TenantSettingsService,
    private readonly clients: ClientsService,
    private readonly pricing: LinePricingService,
  ) {}

  private audited(action: string, id: string, ip: string) {
    return this.audit.tenant({
      actorType: 'USER',
      actorId: requireContext(this.cls, 'userId'),
      action,
      targetType: 'quotation',
      targetId: id,
      ip,
    });
  }

  private async find(id: string): Promise<Row> {
    // Scoped: another atelier's quotation is not found (404).
    const q = await this.tenantDb.db().quotation.findFirst({ where: { id }, include: INCLUDE });
    if (!q) throw new NotFoundError('Quotation not found.');
    return q;
  }

  async get(id: string) {
    return toQuotation(await this.find(id));
  }

  /** Newest first, keyset-paginated; items omitted (the response schema strips them). */
  async list(query: QuotationListQuery) {
    if (query.clientId) await this.clients.get(query.clientId);
    const where: Prisma.QuotationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
    };
    const rows = await this.tenantDb.db().quotation.findMany({
      where: query.cursor ? { AND: [where, afterCursor(decodeCursor(query.cursor))] } : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: { ...INCLUDE, items: false },
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const hasMore = rows.length > query.limit;
    return new Paginated(
      page.map((q) => toQuotation({ ...q, items: [] })),
      { hasMore, nextCursor: hasMore && last ? encodeCursor(last) : null },
    );
  }

  private async writeItems(quotationId: string, items: BuiltLines['items']) {
    await this.tenantDb.db().quotationItem.createMany({
      data: items.map((i) => ({
        quotationId,
        ...i,
        options: i.options as unknown as Prisma.InputJsonValue,
      })) as never,
    });
  }

  async create(input: CreateQuotationRequest, ip: string) {
    const client = await this.clients.get(input.clientId);
    const built = await this.pricing.build(client.id, input.items, input.discount);
    const { timezone } = await this.settings.settings();
    const id = await this.tenantDb.withTenantTx(async () => {
      const q = await this.tenantDb.db().quotation.create({
        data: {
          number: await this.counters.next('QUO', yearIn(timezone)),
          clientId: client.id,
          currency: built.currency,
          ...built.header,
          validUntil: input.validUntil ? asDate(input.validUntil) : null,
          notes: input.notes ?? null,
          createdByMembershipId: requireContext(this.cls, 'membershipId'),
        } as never,
      });
      await this.writeItems(q.id, built.items);
      await this.audited('quotation.created', q.id, ip);
      return q.id;
    });
    return this.get(id);
  }

  /** Replaces a draft as a whole; 409 if someone else changed it since `version`. */
  async update(id: string, input: UpdateQuotationRequest, ip: string) {
    const current = await this.find(id);
    if (current.status !== 'DRAFT') throw invalidStatus('edit', current.status);
    await this.clients.get(current.clientId); // an erased client's drafts are frozen (404)
    const built = await this.pricing.build(current.clientId, input.items, input.discount);
    await this.tenantDb.withTenantTx(async () => {
      const { count } = await this.tenantDb.db().quotation.updateMany({
        where: { id, status: 'DRAFT', version: input.version },
        data: {
          ...built.header,
          validUntil: input.validUntil ? asDate(input.validUntil) : null,
          notes: input.notes ?? null,
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        throw conflict(
          'VERSION_CONFLICT',
          'This quotation was changed by someone else. Reload it.',
        );
      }
      await this.tenantDb.db().quotationItem.deleteMany({ where: { quotationId: id } });
      await this.writeItems(id, built.items);
      await this.audited('quotation.updated', id, ip);
    });
    return this.get(id);
  }

  /** Moves the quotation from one of `from` to a new status; 409 if it isn't in one of them. */
  private async transition(
    id: string,
    action: string,
    from: Status[],
    data: Prisma.QuotationUpdateManyMutationInput,
    ip: string,
  ) {
    await this.tenantDb.withTenantTx(async () => {
      const { count } = await this.tenantDb.db().quotation.updateMany({
        where: { id, status: { in: from } },
        data: { ...data, version: { increment: 1 } },
      });
      if (count === 0) throw invalidStatus(action, (await this.find(id)).status);
      await this.audited(`quotation.${action}`, id, ip);
    });
    return this.get(id);
  }

  async send(id: string, ip: string) {
    const q = await this.find(id);
    if (q.status !== 'DRAFT') throw invalidStatus('send', q.status);
    await this.clients.get(q.clientId); // an erased client's drafts are frozen (404)
    if (q.items.length === 0) {
      throw new ValidationFailedError([
        { path: ['items'], message: 'Add at least one item before sending' },
      ]);
    }
    const { timezone } = await this.settings.settings();
    if (!q.validUntil || isoDate(q.validUntil) < todayIn(timezone)) {
      throw new ValidationFailedError([
        { path: ['validUntil'], message: 'Set a valid-until date of today or later' },
      ]);
    }
    return this.transition(id, 'send', ['DRAFT'], { status: 'SENT', sentAt: new Date() }, ip);
  }

  /** Staff record the client's answer (the customer link is Phase 5). */
  async decide(id: string, accepted: boolean, ip: string) {
    const q = await this.find(id);
    const action = accepted ? 'accept' : 'reject';
    if (q.status !== 'SENT') throw invalidStatus(action, q.status);
    const { timezone } = await this.settings.settings();
    if (accepted && isoDate(q.validUntil!) < todayIn(timezone)) {
      throw conflict('QUOTATION_EXPIRED', 'This quotation has expired. Create a new revision.');
    }
    return this.transition(
      id,
      action,
      ['SENT'],
      { status: accepted ? 'ACCEPTED' : 'REJECTED', decidedAt: new Date() },
      ip,
    );
  }

  /** A new draft with the same number and items; the old quotation becomes SUPERSEDED. */
  async revise(id: string, ip: string) {
    const newId = await this.tenantDb.withTenantTx(async () => {
      const db = this.tenantDb.db();
      const old = await this.find(id);
      await this.clients.get(old.clientId); // no new drafts for an erased client (404)
      const { count } = await db.quotation.updateMany({
        where: { id, status: { in: ['SENT', 'REJECTED', 'EXPIRED'] } },
        data: { status: 'SUPERSEDED', version: { increment: 1 } },
      });
      if (count === 0) throw invalidStatus('revise', old.status);
      try {
        const q = await db.quotation.create({
          data: {
            number: old.number,
            revision: old.revision + 1,
            supersedesId: old.id,
            clientId: old.clientId,
            currency: old.currency,
            subtotal: old.subtotal,
            discount: old.discount,
            tax: old.tax,
            total: old.total,
            taxRate: old.taxRate,
            pricesIncludeTax: old.pricesIncludeTax,
            validUntil: null,
            notes: old.notes,
            createdByMembershipId: requireContext(this.cls, 'membershipId'),
          } as never,
        });
        await db.quotationItem.createMany({
          data: old.items.map(({ id: _id, quotationId: _q, tenantId: _t, ...i }) => ({
            ...i,
            quotationId: q.id,
            options: i.options as Prisma.InputJsonValue,
          })) as never,
        });
        await this.audited('quotation.revised', q.id, ip);
        return q.id;
      } catch (err) {
        if (isUniqueViolation(err)) throw invalidStatus('revise', 'SUPERSEDED');
        throw err;
      }
    });
    return this.get(newId);
  }

  // ----- Data-subject rights (ADR-032); called by PrivacyService inside its transaction ---

  async exportForClient(clientId: string) {
    const rows = await this.tenantDb.db().quotation.findMany({
      where: { clientId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: INCLUDE,
    });
    return rows.map(toQuotation);
  }

  /**
   * Refuses while the client has sent quotations awaiting an answer (an offer they hold).
   * Otherwise clears free-text notes and the measurement links (the measurements are deleted
   * next). Prices and items stay. Drafts stay too, frozen: the erased client is not found.
   */
  async eraseForClient(clientId: string): Promise<void> {
    const db = this.tenantDb.db();
    const open = await db.quotation.count({ where: { clientId, status: 'SENT' } });
    if (open > 0) {
      throw conflict(
        'CLIENT_HAS_OPEN_QUOTATIONS',
        'Record the client’s answer to their sent quotations before erasing their data.',
      );
    }
    await db.quotation.updateMany({ where: { clientId }, data: { notes: null } });
    await db.quotationItem.updateMany({
      where: { quotation: { clientId }, measurementRecordId: { not: null } },
      data: { measurementRecordId: null },
    });
  }
}
