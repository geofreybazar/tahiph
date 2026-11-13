import { Module } from '@nestjs/common';
import { CounterService } from '../../core/numbering/counter.service.js';
import { QueueModule } from '../../core/queue/queue.module.js';
import { TenantJobRunner } from '../../core/tenancy/tenant-job-runner.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { MeasurementsModule } from '../measurements/measurements.module.js';
import { TenantSettingsService } from '../tenants/tenant-settings.service.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { QuotationExpiryService } from './quotation-expiry.service.js';
import { QuotationsController } from './quotations.controller.js';
import { QuotationsProcessor } from './quotations.processor.js';
import { QuotationsService } from './quotations.service.js';

/** Quotations over HTTP (ADR-033). */
@Module({
  imports: [ClientsModule, TenantsModule, CatalogModule, MeasurementsModule],
  controllers: [QuotationsController],
  providers: [QuotationsService, CounterService],
  exports: [QuotationsService],
})
export class QuotationsModule {}

/** Worker side: hourly expiry of sent quotations. No controllers. */
@Module({
  imports: [QueueModule],
  providers: [TenantJobRunner, TenantSettingsService, QuotationExpiryService, QuotationsProcessor],
})
export class QuotationsWorkerModule {}
