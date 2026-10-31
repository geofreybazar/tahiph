import { Controller, Get, Query } from '@nestjs/common';
import { reportPeriodSchema } from '@tahi/shared';
import { createZodDto } from 'nestjs-zod';
import { TenantRoute } from '../../common/auth/decorators';
import { ReportsService } from './reports.service';

class ReportPeriodDto extends createZodDto(reportPeriodSchema) {}

/** The one dashboard route staff may use: it never carries money. */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly reports: ReportsService) {}

  @TenantRoute()
  @Get('operations')
  operations() {
    return this.reports.operationsDashboard();
  }

  @TenantRoute('finance:read')
  @Get('financial')
  financial() {
    return this.reports.financialDashboard();
  }
}

@Controller('reports')
@TenantRoute('finance:read')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales')
  sales(@Query() query: ReportPeriodDto) {
    return this.reports.sales(query as never);
  }

  @Get('revenue')
  revenue(@Query() query: ReportPeriodDto) {
    return this.reports.revenue(query as never);
  }

  @Get('profit')
  profit(@Query() query: ReportPeriodDto) {
    return this.reports.profit(query as never);
  }

  @Get('receivables')
  receivables() {
    return this.reports.receivables();
  }

  @Get('operations')
  operations(@Query() query: ReportPeriodDto) {
    return this.reports.operations(query as never);
  }
}
