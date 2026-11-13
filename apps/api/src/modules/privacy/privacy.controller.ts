import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  clientExportSchema,
  clientParamsSchema,
  eraseClientRequestSchema,
  type EraseClientRequest,
} from '@tahi/validation';
import type { Request } from 'express';
import { z } from 'zod';
import { clientIp } from '../../core/auth/client-ip.js';
import { Realm, RequirePermission } from '../../core/auth/decorators.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { References, ResponseSchema } from '../../core/http/contract.js';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { PrivacyService } from './privacy.service.js';

type IdParams = { id: string };
const idPipe = () => new ZodValidationPipe(clientParamsSchema);

/** A client's data-subject rights: export and erasure (RA 10173, ADR-032). */
@Controller('tenant/clients/:id')
@Realm('tenant')
export class PrivacyController {
  constructor(
    private readonly privacy: PrivacyService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('export')
  @ResponseSchema(clientExportSchema)
  @References({ id: 'client' })
  @RequirePermission('clients.privacy')
  export(@Param(idPipe()) p: IdParams, @Req() req: Request) {
    return this.privacy.export(p.id, clientIp(req, this.env));
  }

  @Post('erase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema(z.null())
  @References({ id: 'erasableClient' })
  @RequirePermission('clients.privacy')
  erase(
    @Param(idPipe()) p: IdParams,
    @Body(new ZodValidationPipe(eraseClientRequestSchema)) body: EraseClientRequest,
    @Req() req: Request,
  ) {
    return this.privacy.erase(p.id, body, clientIp(req, this.env));
  }
}
