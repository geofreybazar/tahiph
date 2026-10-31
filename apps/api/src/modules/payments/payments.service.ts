import { Inject, Injectable } from '@nestjs/common';
import { replacePaymentScheduleSchema } from '@tahi/shared';
import { z } from 'zod';
import { ApiException } from '../../common/http/api-exception';
import { fromDbDate, toDbDate } from '../../common/http/dates';
import type { ScopedPrisma } from '../../common/prisma/prisma-clients';
import { SCOPED_PRISMA } from '../../common/prisma/scoped-prisma.token';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrisma,
    private readonly projects: ProjectsService,
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
}
