import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import {
  AppointmentsController,
  AppointmentTypesController,
  StaffScheduleController,
} from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';

@Module({
  imports: [ClientsModule, TenantsModule],
  controllers: [AppointmentTypesController, StaffScheduleController, AppointmentsController],
  providers: [AppointmentsService],
})
export class AppointmentsModule {}
