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
  Req,
} from '@nestjs/common';
import {
  createRoleRequestSchema,
  roleParamsSchema,
  roleSchema,
  updateRoleRequestSchema,
  type CreateRoleRequest,
  type UpdateRoleRequest,
} from '@tahi/validation';
import type { Request } from 'express';
import { z } from 'zod';
import { clientIp } from '../../core/auth/client-ip.js';
import { Realm, RequirePermission } from '../../core/auth/decorators.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { References, ResponseSchema } from '../../core/http/contract.js';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { RolesService } from './roles.service.js';

/** Custom and system roles of the active atelier (ADR-025). */
@Controller('tenant/roles')
@Realm('tenant')
export class RolesController {
  constructor(
    private readonly roles: RolesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ResponseSchema(z.array(roleSchema))
  @RequirePermission('staff.read')
  list() {
    return this.roles.list();
  }

  @Post()
  @ResponseSchema(roleSchema)
  @RequirePermission('roles.manage')
  create(
    @Body(new ZodValidationPipe(createRoleRequestSchema)) body: CreateRoleRequest,
    @Req() req: Request,
  ) {
    return this.roles.create(body, clientIp(req, this.env));
  }

  @Patch(':id')
  @ResponseSchema(roleSchema)
  @References({ id: 'role' })
  @RequirePermission('roles.manage')
  update(
    @Param(new ZodValidationPipe(roleParamsSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateRoleRequestSchema)) body: UpdateRoleRequest,
    @Req() req: Request,
  ) {
    return this.roles.update(params.id, body, clientIp(req, this.env));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema(z.null())
  @References({ id: 'customRole' })
  @RequirePermission('roles.manage')
  remove(
    @Param(new ZodValidationPipe(roleParamsSchema)) params: { id: string },
    @Req() req: Request,
  ) {
    return this.roles.remove(params.id, clientIp(req, this.env));
  }
}
