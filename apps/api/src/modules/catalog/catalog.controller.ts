import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  catalogCategorySchema,
  catalogIdParamsSchema,
  catalogItemDetailSchema,
  catalogItemListQuerySchema,
  catalogItemSchema,
  catalogOptionGroupSchema,
  createCatalogCategoryRequestSchema,
  createCatalogItemRequestSchema,
  createOptionGroupRequestSchema,
  createOptionRequestSchema,
  optionParamsSchema,
  setItemOptionGroupsRequestSchema,
  updateCatalogCategoryRequestSchema,
  updateCatalogItemRequestSchema,
  updateOptionGroupRequestSchema,
  updateOptionRequestSchema,
  type CatalogItemListQuery,
  type CreateCatalogCategoryRequest,
  type CreateCatalogItemRequest,
  type CreateOptionGroupRequest,
  type CreateOptionRequest,
  type SetItemOptionGroupsRequest,
  type UpdateCatalogCategoryRequest,
  type UpdateCatalogItemRequest,
  type UpdateOptionGroupRequest,
  type UpdateOptionRequest,
} from '@tahi/validation';
import type { Request } from 'express';
import { z } from 'zod';
import { clientIp } from '../../core/auth/client-ip.js';
import { Realm, RequirePermission } from '../../core/auth/decorators.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { References, ResponseSchema } from '../../core/http/contract.js';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { CatalogService } from './catalog.service.js';
import { OptionGroupsService } from './option-groups.service.js';

type IdParams = { id: string };
type OptionParams = { id: string; optionId: string };
const idPipe = () => new ZodValidationPipe(catalogIdParamsSchema);
const optionPipe = () => new ZodValidationPipe(optionParamsSchema);

@Controller('tenant/catalog/categories')
@Realm('tenant')
export class CatalogCategoriesController {
  constructor(
    private readonly catalog: CatalogService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ResponseSchema(z.array(catalogCategorySchema))
  @RequirePermission('catalog.read')
  list() {
    return this.catalog.listCategories();
  }

  @Post()
  @ResponseSchema(catalogCategorySchema)
  @RequirePermission('catalog.write')
  create(
    @Body(new ZodValidationPipe(createCatalogCategoryRequestSchema))
    body: CreateCatalogCategoryRequest,
    @Req() req: Request,
  ) {
    return this.catalog.createCategory(body, clientIp(req, this.env));
  }

  @Patch(':id')
  @ResponseSchema(catalogCategorySchema)
  @References({ id: 'catalogCategory' })
  @RequirePermission('catalog.write')
  update(
    @Param(idPipe()) p: IdParams,
    @Body(new ZodValidationPipe(updateCatalogCategoryRequestSchema))
    body: UpdateCatalogCategoryRequest,
    @Req() req: Request,
  ) {
    return this.catalog.updateCategory(p.id, body, clientIp(req, this.env));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(catalogCategorySchema)
  @References({ id: 'catalogCategory' })
  @RequirePermission('catalog.write')
  archive(@Param(idPipe()) p: IdParams, @Req() req: Request) {
    return this.catalog.setCategoryArchived(p.id, true, clientIp(req, this.env));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(catalogCategorySchema)
  @References({ id: 'catalogCategory' })
  @RequirePermission('catalog.write')
  restore(@Param(idPipe()) p: IdParams, @Req() req: Request) {
    return this.catalog.setCategoryArchived(p.id, false, clientIp(req, this.env));
  }
}

@Controller('tenant/catalog/items')
@Realm('tenant')
export class CatalogItemsController {
  constructor(
    private readonly catalog: CatalogService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ResponseSchema(catalogItemSchema, { paginated: true })
  @References({ categoryId: 'catalogCategory' })
  @RequirePermission('catalog.read')
  list(@Query(new ZodValidationPipe(catalogItemListQuerySchema)) query: CatalogItemListQuery) {
    return this.catalog.listItems(query);
  }

  @Post()
  @ResponseSchema(catalogItemDetailSchema)
  @References({ categoryId: 'catalogCategory' })
  @RequirePermission('catalog.write')
  create(
    @Body(new ZodValidationPipe(createCatalogItemRequestSchema)) body: CreateCatalogItemRequest,
    @Req() req: Request,
  ) {
    return this.catalog.createItem(body, clientIp(req, this.env));
  }

  @Get(':id')
  @ResponseSchema(catalogItemDetailSchema)
  @References({ id: 'catalogItem' })
  @RequirePermission('catalog.read')
  get(@Param(idPipe()) p: IdParams) {
    return this.catalog.getItem(p.id);
  }

  @Patch(':id')
  @ResponseSchema(catalogItemDetailSchema)
  @References({ id: 'catalogItem', categoryId: 'catalogCategory' })
  @RequirePermission('catalog.write')
  update(
    @Param(idPipe()) p: IdParams,
    @Body(new ZodValidationPipe(updateCatalogItemRequestSchema)) body: UpdateCatalogItemRequest,
    @Req() req: Request,
  ) {
    return this.catalog.updateItem(p.id, body, clientIp(req, this.env));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(catalogItemDetailSchema)
  @References({ id: 'catalogItem' })
  @RequirePermission('catalog.write')
  archive(@Param(idPipe()) p: IdParams, @Req() req: Request) {
    return this.catalog.setItemArchived(p.id, true, clientIp(req, this.env));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(catalogItemDetailSchema)
  @References({ id: 'catalogItem' })
  @RequirePermission('catalog.write')
  restore(@Param(idPipe()) p: IdParams, @Req() req: Request) {
    return this.catalog.setItemArchived(p.id, false, clientIp(req, this.env));
  }

  @Put(':id/option-groups')
  @ResponseSchema(catalogItemDetailSchema)
  @References({ id: 'catalogItem', groupIds: 'optionGroup' })
  @RequirePermission('catalog.write')
  setOptionGroups(
    @Param(idPipe()) p: IdParams,
    @Body(new ZodValidationPipe(setItemOptionGroupsRequestSchema)) body: SetItemOptionGroupsRequest,
    @Req() req: Request,
  ) {
    return this.catalog.setOptionGroups(p.id, body.groupIds, clientIp(req, this.env));
  }
}

@Controller('tenant/catalog/option-groups')
@Realm('tenant')
export class OptionGroupsController {
  constructor(
    private readonly groups: OptionGroupsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ResponseSchema(z.array(catalogOptionGroupSchema))
  @RequirePermission('catalog.read')
  list() {
    return this.groups.list();
  }

  @Post()
  @ResponseSchema(catalogOptionGroupSchema)
  @RequirePermission('catalog.write')
  create(
    @Body(new ZodValidationPipe(createOptionGroupRequestSchema)) body: CreateOptionGroupRequest,
    @Req() req: Request,
  ) {
    return this.groups.create(body, clientIp(req, this.env));
  }

  @Get(':id')
  @ResponseSchema(catalogOptionGroupSchema)
  @References({ id: 'optionGroup' })
  @RequirePermission('catalog.read')
  get(@Param(idPipe()) p: IdParams) {
    return this.groups.get(p.id);
  }

  @Patch(':id')
  @ResponseSchema(catalogOptionGroupSchema)
  @References({ id: 'optionGroup' })
  @RequirePermission('catalog.write')
  update(
    @Param(idPipe()) p: IdParams,
    @Body(new ZodValidationPipe(updateOptionGroupRequestSchema)) body: UpdateOptionGroupRequest,
    @Req() req: Request,
  ) {
    return this.groups.update(p.id, body, clientIp(req, this.env));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(catalogOptionGroupSchema)
  @References({ id: 'optionGroup' })
  @RequirePermission('catalog.write')
  archive(@Param(idPipe()) p: IdParams, @Req() req: Request) {
    return this.groups.setArchived(p.id, true, clientIp(req, this.env));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(catalogOptionGroupSchema)
  @References({ id: 'optionGroup' })
  @RequirePermission('catalog.write')
  restore(@Param(idPipe()) p: IdParams, @Req() req: Request) {
    return this.groups.setArchived(p.id, false, clientIp(req, this.env));
  }

  @Post(':id/options')
  @ResponseSchema(catalogOptionGroupSchema)
  @References({ id: 'optionGroup' })
  @RequirePermission('catalog.write')
  addOption(
    @Param(idPipe()) p: IdParams,
    @Body(new ZodValidationPipe(createOptionRequestSchema)) body: CreateOptionRequest,
    @Req() req: Request,
  ) {
    return this.groups.addOption(p.id, body, clientIp(req, this.env));
  }

  @Patch(':id/options/:optionId')
  @ResponseSchema(catalogOptionGroupSchema)
  @References({ id: 'optionGroup', optionId: 'catalogOption' })
  @RequirePermission('catalog.write')
  updateOption(
    @Param(optionPipe()) p: OptionParams,
    @Body(new ZodValidationPipe(updateOptionRequestSchema)) body: UpdateOptionRequest,
    @Req() req: Request,
  ) {
    return this.groups.updateOption(p.id, p.optionId, body, clientIp(req, this.env));
  }

  @Post(':id/options/:optionId/archive')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(catalogOptionGroupSchema)
  @References({ id: 'optionGroup', optionId: 'catalogOption' })
  @RequirePermission('catalog.write')
  archiveOption(@Param(optionPipe()) p: OptionParams, @Req() req: Request) {
    return this.groups.setOptionArchived(p.id, p.optionId, true, clientIp(req, this.env));
  }

  @Post(':id/options/:optionId/restore')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(catalogOptionGroupSchema)
  @References({ id: 'optionGroup', optionId: 'catalogOption' })
  @RequirePermission('catalog.write')
  restoreOption(@Param(optionPipe()) p: OptionParams, @Req() req: Request) {
    return this.groups.setOptionArchived(p.id, p.optionId, false, clientIp(req, this.env));
  }
}
