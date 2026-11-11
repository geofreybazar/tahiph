import {
  Body,
  Controller,
  Delete,
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
  businessProfileRequestSchema,
  businessProfileSchema,
  createHolidayRequestSchema,
  holidayParamsSchema,
  holidaySchema,
  operatingHoursRequestSchema,
  operatingHoursSchema,
  tenantSettingsSchema,
  updateTenantSettingsRequestSchema,
  type BusinessProfileRequest,
  type CreateHolidayRequest,
  type OperatingHoursRequest,
  type UpdateTenantSettingsRequest,
} from '@tahi/validation';
import type { Request } from 'express';
import { z } from 'zod';
import { clientIp } from '../../core/auth/client-ip.js';
import { ActiveMember, Realm, RequirePermission } from '../../core/auth/decorators.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { References, ResponseSchema } from '../../core/http/contract.js';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { TenantSettingsService } from './tenant-settings.service.js';

/** Business profile, settings, opening hours and holidays of the active atelier (ADR-024). */
@Controller('tenant')
@Realm('tenant')
export class TenantSettingsController {
  constructor(
    private readonly settings: TenantSettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('profile')
  @ResponseSchema(businessProfileSchema)
  @ActiveMember()
  profile() {
    return this.settings.profile();
  }

  @Put('profile')
  @ResponseSchema(businessProfileSchema)
  @RequirePermission('tenant.settings')
  replaceProfile(
    @Body(new ZodValidationPipe(businessProfileRequestSchema)) body: BusinessProfileRequest,
    @Req() req: Request,
  ) {
    return this.settings.replaceProfile(body, clientIp(req, this.env));
  }

  @Get('settings')
  @ResponseSchema(tenantSettingsSchema)
  @ActiveMember()
  get() {
    return this.settings.settings();
  }

  @Patch('settings')
  @ResponseSchema(tenantSettingsSchema)
  @RequirePermission('tenant.settings')
  update(
    @Body(new ZodValidationPipe(updateTenantSettingsRequestSchema))
    body: UpdateTenantSettingsRequest,
    @Req() req: Request,
  ) {
    return this.settings.updateSettings(body, clientIp(req, this.env));
  }

  @Get('operating-hours')
  @ResponseSchema(operatingHoursSchema)
  @ActiveMember()
  operatingHours() {
    return this.settings.operatingHours();
  }

  @Put('operating-hours')
  @ResponseSchema(operatingHoursSchema)
  @RequirePermission('tenant.settings')
  replaceOperatingHours(
    @Body(new ZodValidationPipe(operatingHoursRequestSchema)) body: OperatingHoursRequest,
    @Req() req: Request,
  ) {
    return this.settings.replaceOperatingHours(body, clientIp(req, this.env));
  }

  @Get('holidays')
  @ResponseSchema(z.array(holidaySchema))
  @ActiveMember()
  holidays() {
    return this.settings.holidays();
  }

  @Post('holidays')
  @ResponseSchema(holidaySchema)
  @RequirePermission('tenant.settings')
  createHoliday(
    @Body(new ZodValidationPipe(createHolidayRequestSchema)) body: CreateHolidayRequest,
    @Req() req: Request,
  ) {
    return this.settings.createHoliday(body, clientIp(req, this.env));
  }

  @Delete('holidays/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema(z.null())
  @References({ id: 'holiday' })
  @RequirePermission('tenant.settings')
  deleteHoliday(
    @Param(new ZodValidationPipe(holidayParamsSchema)) params: { id: string },
    @Req() req: Request,
  ) {
    return this.settings.deleteHoliday(params.id, clientIp(req, this.env));
  }
}
