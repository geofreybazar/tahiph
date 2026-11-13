import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module.js';
import { MeasurementsModule } from '../measurements/measurements.module.js';
import { QuotationsModule } from '../quotations/quotations.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

/** Orders (ADR-034). Pricing and numbering come from QuotationsModule. */
@Module({
  imports: [ClientsModule, TenantsModule, MeasurementsModule, QuotationsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
