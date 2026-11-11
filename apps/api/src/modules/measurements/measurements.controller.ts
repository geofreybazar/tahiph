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
  Req,
} from '@nestjs/common';
import {
  categoryParamsSchema,
  clientParamsSchema,
  createGarmentCategoryRequestSchema,
  createMeasurementRecordRequestSchema,
  garmentCategorySchema,
  measurementRecordParamsSchema,
  measurementRecordSchema,
  measurementTemplateSchema,
  renameGarmentCategoryRequestSchema,
  saveTemplateRequestSchema,
  templateParamsSchema,
  type CreateGarmentCategoryRequest,
  type CreateMeasurementRecordRequest,
  type SaveTemplateRequest,
} from '@tahi/validation';
import type { Request } from 'express';
import { z } from 'zod';
import { clientIp } from '../../core/auth/client-ip.js';
import { Realm, RequirePermission } from '../../core/auth/decorators.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { References, ResponseSchema } from '../../core/http/contract.js';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { MeasurementsService } from './measurements.service.js';

type IdParams = { id: string };
const idPipe = () => new ZodValidationPipe(categoryParamsSchema);

/** Garment categories and their versioned templates (ADR-027). */
@Controller('tenant/garment-categories')
@Realm('tenant')
export class GarmentCategoriesController {
  constructor(
    private readonly measurements: MeasurementsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ResponseSchema(z.array(garmentCategorySchema))
  @RequirePermission('measurements.read')
  list() {
    return this.measurements.listCategories();
  }

  @Post()
  @ResponseSchema(garmentCategorySchema)
  @RequirePermission('tenant.settings')
  create(
    @Body(new ZodValidationPipe(createGarmentCategoryRequestSchema))
    body: CreateGarmentCategoryRequest,
    @Req() req: Request,
  ) {
    return this.measurements.createCategory(body.name, clientIp(req, this.env));
  }

  @Patch(':id')
  @ResponseSchema(garmentCategorySchema)
  @References({ id: 'garmentCategory' })
  @RequirePermission('tenant.settings')
  rename(
    @Param(idPipe()) p: IdParams,
    @Body(new ZodValidationPipe(renameGarmentCategoryRequestSchema))
    body: CreateGarmentCategoryRequest,
    @Req() req: Request,
  ) {
    return this.measurements.renameCategory(p.id, body.name, clientIp(req, this.env));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(garmentCategorySchema)
  @References({ id: 'garmentCategory' })
  @RequirePermission('tenant.settings')
  archive(@Param(idPipe()) p: IdParams, @Req() req: Request) {
    return this.measurements.setArchived(p.id, true, clientIp(req, this.env));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(garmentCategorySchema)
  @References({ id: 'garmentCategory' })
  @RequirePermission('tenant.settings')
  restore(@Param(idPipe()) p: IdParams, @Req() req: Request) {
    return this.measurements.setArchived(p.id, false, clientIp(req, this.env));
  }

  @Get(':id/template')
  @ResponseSchema(measurementTemplateSchema)
  @References({ id: 'garmentCategory' })
  @RequirePermission('measurements.read')
  template(@Param(idPipe()) p: IdParams) {
    return this.measurements.currentTemplate(p.id);
  }

  @Put(':id/template')
  @ResponseSchema(measurementTemplateSchema)
  @References({ id: 'garmentCategory' })
  @RequirePermission('tenant.settings')
  saveTemplate(
    @Param(idPipe()) p: IdParams,
    @Body(new ZodValidationPipe(saveTemplateRequestSchema)) body: SaveTemplateRequest,
    @Req() req: Request,
  ) {
    return this.measurements.saveTemplate(p.id, body, clientIp(req, this.env));
  }
}

/** Template versions and measurement records (ADR-027). Records are never updated or deleted. */
@Controller('tenant')
@Realm('tenant')
export class MeasurementsController {
  constructor(
    private readonly measurements: MeasurementsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('measurement-templates/:id')
  @ResponseSchema(measurementTemplateSchema)
  @References({ id: 'measurementTemplate' })
  @RequirePermission('measurements.read')
  template(@Param(new ZodValidationPipe(templateParamsSchema)) p: IdParams) {
    return this.measurements.template(p.id);
  }

  @Get('clients/:id/measurements')
  @ResponseSchema(z.array(measurementRecordSchema))
  @References({ id: 'client' })
  @RequirePermission('measurements.read')
  list(@Param(new ZodValidationPipe(clientParamsSchema)) p: IdParams) {
    return this.measurements.listRecords(p.id);
  }

  @Post('clients/:id/measurements')
  @ResponseSchema(measurementRecordSchema)
  @References({ id: 'client', categoryId: 'garmentCategory', supersedesId: 'measurementRecord' })
  @RequirePermission('measurements.write')
  create(
    @Param(new ZodValidationPipe(clientParamsSchema)) p: IdParams,
    @Body(new ZodValidationPipe(createMeasurementRecordRequestSchema))
    body: CreateMeasurementRecordRequest,
    @Req() req: Request,
  ) {
    return this.measurements.createRecord(p.id, body, clientIp(req, this.env));
  }

  @Get('measurements/:recordId')
  @ResponseSchema(measurementRecordSchema)
  @References({ recordId: 'measurementRecord' })
  @RequirePermission('measurements.read')
  record(@Param(new ZodValidationPipe(measurementRecordParamsSchema)) p: { recordId: string }) {
    return this.measurements.record(p.recordId);
  }
}
