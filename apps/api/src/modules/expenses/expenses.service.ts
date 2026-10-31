import { Inject, Injectable } from '@nestjs/common';
import { expenseInputSchema, listExpensesSchema } from '@tahi/shared';
import { z } from 'zod';
import { ApiException } from '../../common/http/api-exception';
import { fromDbDate, toDbDate } from '../../common/http/dates';
import { Paginated } from '../../common/http/paginated';
import type { ScopedPrisma } from '../../common/prisma/prisma-clients';
import { SCOPED_PRISMA } from '../../common/prisma/scoped-prisma.token';
import { RequestContext } from '../../common/request-context/request-context';
import { MediaService } from '../media/media.service';
import { ProjectsService } from '../projects/projects.service';

type ExpenseInput = z.output<typeof expenseInputSchema>;

const notFound = () => new ApiException(404, 'NOT_FOUND', 'Expense not found');
const PROJECT = { project: { select: { id: true, projectNumber: true, title: true } } } as const;

const present = <T extends { incurredOn: Date }>(expense: T) => ({
  ...expense,
  incurredOn: fromDbDate(expense.incurredOn),
});

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrisma,
    private readonly projects: ProjectsService,
    private readonly media: MediaService,
    private readonly context: RequestContext,
  ) {}

  async list({ page, limit, from, to, kind }: z.output<typeof listExpensesSchema>) {
    const where = {
      deletedAt: null,
      ...(kind ? { kind } : {}),
      ...(from || to
        ? {
            incurredOn: {
              ...(from ? { gte: toDbDate(from)! } : {}),
              ...(to ? { lte: toDbDate(to)! } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.expense.findMany({
        where,
        include: PROJECT,
        orderBy: [{ incurredOn: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.expense.count({ where }),
    ]);
    return new Paginated(items.map(present), { page, limit }, total);
  }

  async create({ incurredOn, ...data }: ExpenseInput) {
    if (data.projectId) await this.projects.assertActive(data.projectId);
    if (data.receiptMediaId)
      await this.media.assertAttachable(data.receiptMediaId, ['expense_receipt']);
    const expense = await this.db.expense.create({
      data: {
        ...data,
        incurredOn: toDbDate(incurredOn),
        recordedByUserId: this.context.principal!.userId,
      } as never,
      include: PROJECT,
    });
    return present(expense);
  }

  private async find(id: string) {
    const expense = await this.db.expense.findFirst({
      where: { id, deletedAt: null },
      include: PROJECT,
    });
    if (!expense) throw notFound();
    return expense;
  }

  async get(id: string) {
    return present(await this.find(id));
  }

  async update(id: string, { incurredOn, ...data }: ExpenseInput) {
    const current = await this.find(id);
    // An expense already on a project that was archived later can stay there.
    if (data.projectId && data.projectId !== current.projectId) {
      await this.projects.assertActive(data.projectId);
    }
    const changesReceipt =
      data.receiptMediaId !== undefined && data.receiptMediaId !== current.receiptMediaId;
    if (changesReceipt && data.receiptMediaId) {
      await this.media.assertAttachable(data.receiptMediaId, ['expense_receipt']);
    }
    const fields = { ...data, incurredOn: toDbDate(incurredOn)! };

    if (changesReceipt && current.receiptMediaId) {
      // Together, so a storage failure leaves the old receipt attached and nothing is lost.
      await this.media.remove(current.receiptMediaId, (tx) =>
        tx.expense.update({ where: { id }, data: fields }),
      );
    } else {
      await this.db.expense.update({ where: { id }, data: fields });
    }
    return this.get(id);
  }

  /** The receipt stays with the soft-deleted row. */
  async remove(id: string): Promise<void> {
    await this.find(id);
    await this.db.expense.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
