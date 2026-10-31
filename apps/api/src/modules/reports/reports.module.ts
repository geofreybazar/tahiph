import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { GarmentsModule } from '../garments/garments.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProjectsModule } from '../projects/projects.module';
import { DashboardController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AppointmentsModule, ExpensesModule, GarmentsModule, PaymentsModule, ProjectsModule],
  controllers: [DashboardController, ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
