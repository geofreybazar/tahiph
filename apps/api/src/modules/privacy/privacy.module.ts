import { Module } from '@nestjs/common';
import { AuditModule } from '../../core/audit/audit.module.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { MeasurementsModule } from '../measurements/measurements.module.js';
import { PrivacyController } from './privacy.controller.js';
import { PrivacyService } from './privacy.service.js';

/** Data-subject export and erasure across the modules that hold client data (ADR-032). */
@Module({
  imports: [AuditModule, ClientsModule, MeasurementsModule, AppointmentsModule],
  controllers: [PrivacyController],
  providers: [PrivacyService],
})
export class PrivacyModule {}
