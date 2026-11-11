import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { GarmentCategoriesController, MeasurementsController } from './measurements.controller.js';
import { MeasurementsService } from './measurements.service.js';

@Module({
  imports: [ClientsModule, TenantsModule],
  controllers: [GarmentCategoriesController, MeasurementsController],
  providers: [MeasurementsService],
})
export class MeasurementsModule {}
