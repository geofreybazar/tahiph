import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module.js';
import {
  CatalogCategoriesController,
  CatalogItemsController,
  OptionGroupsController,
} from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { OptionGroupsService } from './option-groups.service.js';

@Module({
  imports: [TenantsModule],
  controllers: [CatalogCategoriesController, CatalogItemsController, OptionGroupsController],
  providers: [CatalogService, OptionGroupsService],
  exports: [CatalogService],
})
export class CatalogModule {}
