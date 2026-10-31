import { Injectable } from '@nestjs/common';
import { reportPeriodSchema } from '@tahi/shared';
import { z } from 'zod';
import { ApiException } from '../../common/http/api-exception';
import {
  addMonths,
  fromDbDate,
  manilaMonth,
  manilaMonthRange,
  monthsBetween,
} from '../../common/http/dates';
import { AppointmentsService } from '../appointments/appointments.service';
import { ExpensesService } from '../expenses/expenses.service';
import { GarmentsService } from '../garments/garments.service';
import { deriveBalance, PaymentsService } from '../payments/payments.service';
import { ProjectsService } from '../projects/projects.service';

type Period = z.output<typeof reportPeriodSchema>;

const MAX_MONTHS = 36;
const UPCOMING_FITTINGS = 10;

/** One row per month in the period, including months where nothing happened. */
function byMonth<T extends object>(months: string[], empty: () => T): Map<string, T> {
  return new Map(months.map((month) => [month, empty()]));
}

const sumOf = <T>(rows: T[], value: (row: T) => number) =>
  rows.reduce((total, row) => total + value(row), 0);

/**
 * Sums are plain JavaScript numbers, exact up to about ₱90 trillion, so totals can pass the ₱21.4M
 * limit of an `Int` column. shortcut: loads the period's rows and groups them here rather than in
 * SQL, which keeps tenant scoping on and raw SQL out; move to SQL if a report ever gets slow.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly expenses: ExpensesService,
    private readonly garments: GarmentsService,
    private readonly payments: PaymentsService,
    private readonly projects: ProjectsService,
  ) {}

  private period({ from, to }: Period): { from: string; to: string; months: string[] } {
    const end = to ?? manilaMonth(new Date());
    const start = from ?? addMonths(end, -11);
    if (start > end) throw new ApiException(400, 'BAD_REQUEST', 'The period ends before it starts');
    if (start < addMonths(end, -(MAX_MONTHS - 1))) {
      throw new ApiException(400, 'BAD_REQUEST', `A report covers at most ${MAX_MONTHS} months`);
    }
    return { from: start, to: end, months: monthsBetween(start, end) };
  }

  private async revenueRows(from: string, to: string, months: string[]) {
    const rows = byMonth(months, () => ({ paidCentavos: 0, refundedCentavos: 0 }));
    for (const { kind, amountCentavos, paidAt } of await this.payments.countedBetween(
      manilaMonthRange(from, to),
    )) {
      const row = rows.get(manilaMonth(paidAt))!;
      if (kind === 'payment') row.paidCentavos += amountCentavos;
      else row.refundedCentavos += amountCentavos;
    }
    return months.map((month) => {
      const { paidCentavos, refundedCentavos } = rows.get(month)!;
      return {
        month,
        paidCentavos,
        refundedCentavos,
        revenueCentavos: paidCentavos - refundedCentavos,
      };
    });
  }

  private async profitRows(from: string, to: string, months: string[]) {
    const [revenue, expenses] = await Promise.all([
      this.revenueRows(from, to, months),
      this.expenses.countedBetween(`${from}-01`, `${addMonths(to, 1)}-01`),
    ]);
    const spent = byMonth(months, () => ({ centavos: 0 }));
    for (const { amountCentavos, incurredOn } of expenses) {
      // The upper bound is the next month's first day; `get` skips it.
      const row = spent.get(fromDbDate(incurredOn)!.slice(0, 7));
      if (row) row.centavos += amountCentavos;
    }
    return revenue.map(({ month, revenueCentavos }) => {
      const expensesCentavos = spent.get(month)!.centavos;
      return {
        month,
        revenueCentavos,
        expensesCentavos,
        profitCentavos: revenueCentavos - expensesCentavos,
      };
    });
  }

  async sales(query: Period) {
    const { from, to, months } = this.period(query);
    const rows = byMonth(months, () => ({ orderCount: 0, soldCentavos: 0 }));
    for (const { priceCentavos, createdAt } of await this.projects.soldBetween(
      manilaMonthRange(from, to),
    )) {
      const row = rows.get(manilaMonth(createdAt))!;
      row.orderCount += 1;
      row.soldCentavos += priceCentavos;
    }
    const items = months.map((month) => ({ month, ...rows.get(month)! }));
    return {
      from,
      to,
      items,
      totals: {
        orderCount: sumOf(items, (i) => i.orderCount),
        soldCentavos: sumOf(items, (i) => i.soldCentavos),
      },
    };
  }

  async revenue(query: Period) {
    const { from, to, months } = this.period(query);
    const items = await this.revenueRows(from, to, months);
    return {
      from,
      to,
      items,
      totals: {
        paidCentavos: sumOf(items, (i) => i.paidCentavos),
        refundedCentavos: sumOf(items, (i) => i.refundedCentavos),
        revenueCentavos: sumOf(items, (i) => i.revenueCentavos),
      },
    };
  }

  async profit(query: Period) {
    const { from, to, months } = this.period(query);
    const items = await this.profitRows(from, to, months);
    return {
      from,
      to,
      items,
      totals: {
        revenueCentavos: sumOf(items, (i) => i.revenueCentavos),
        expensesCentavos: sumOf(items, (i) => i.expensesCentavos),
        profitCentavos: sumOf(items, (i) => i.profitCentavos),
      },
    };
  }

  async receivables() {
    const projects = await this.projects.activeForReceivables();
    const movements = await this.payments.countedForProjects(projects.map((p) => p.id));
    const items = projects.map(({ id, projectNumber, title, priceCentavos, client }) => ({
      id,
      projectNumber,
      title,
      clientName: client.fullName,
      ...deriveBalance(
        priceCentavos,
        movements.filter((m) => m.projectId === id),
      ),
    }));
    return { items, totalCentavos: sumOf(items, (i) => i.balanceCentavos) };
  }

  async operations(query: Period) {
    const { from, to, months } = this.period(query);
    const [garmentsByStage, appointments] = await Promise.all([
      this.garments.countByStage(),
      this.appointments.startingBetween(manilaMonthRange(from, to)),
    ]);
    const rows = byMonth(months, () => ({ scheduled: 0, completed: 0, cancelled: 0, no_show: 0 }));
    for (const { status, startsAt } of appointments) rows.get(manilaMonth(startsAt))![status] += 1;
    return {
      from,
      to,
      garmentsByStage,
      appointments: months.map((month) => ({ month, ...rows.get(month)! })),
    };
  }

  /** Open to staff, so nothing here may be money or a tenant-wide total of it. */
  async operationsDashboard() {
    const [garmentsByStage, upcomingFittings] = await Promise.all([
      this.garments.countByStage(),
      this.appointments.upcomingFittings(UPCOMING_FITTINGS),
    ]);
    return { garmentsByStage, upcomingFittings };
  }

  async financialDashboard() {
    const month = manilaMonth(new Date());
    const [[row], { totalCentavos }] = await Promise.all([
      this.profitRows(month, month, [month]),
      this.receivables(),
    ]);
    return { ...row!, receivablesCentavos: totalCentavos };
  }
}
