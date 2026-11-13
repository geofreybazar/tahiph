import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  createQuotationRequestSchema,
  quotationListQuerySchema,
  quotationParamsSchema,
  quotationSchema,
  quotationSummarySchema,
  updateQuotationRequestSchema,
  type CreateQuotationRequest,
  type QuotationListQuery,
  type UpdateQuotationRequest,
} from '@tahi/validation';
import type { Request } from 'express';
import { clientIp } from '../../core/auth/client-ip.js';
import { Realm, RequirePermission } from '../../core/auth/decorators.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { References, ResponseSchema } from '../../core/http/contract.js';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { QuotationsService } from './quotations.service.js';

type IdParams = { id: string };
const idPipe = () => new ZodValidationPipe(quotationParamsSchema);
/** Ids inside quotation items (the cross-tenant suite sends another atelier's for each). */
const ITEM_REFS = {
  'items[].catalogItemId': 'catalogItem',
  'items[].optionIds': 'catalogOption',
  'items[].measurementRecordId': 'measurementRecord',
} as const;

/** Quotations (ADR-033). */
@Controller('tenant/quotations')
@Realm('tenant')
export class QuotationsController {
  constructor(
    private readonly quotations: QuotationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ResponseSchema(quotationSummarySchema, { paginated: true })
  @References({ clientId: 'client' })
  @RequirePermission('quotations.read')
  list(@Query(new ZodValidationPipe(quotationListQuerySchema)) query: QuotationListQuery) {
    return this.quotations.list(query);
  }

  @Post()
  @ResponseSchema(quotationSchema)
  @References({ clientId: 'client', ...ITEM_REFS })
  @RequirePermission('quotations.write')
  create(
    @Body(new ZodValidationPipe(createQuotationRequestSchema)) body: CreateQuotationRequest,
    @Req() req: Request,
  ) {
    return this.quotations.create(body, clientIp(req, this.env));
  }

  @Get(':id')
  @ResponseSchema(quotationSchema)
  @References({ id: 'quotation' })
  @RequirePermission('quotations.read')
  get(@Param(idPipe()) p: IdParams) {
    return this.quotations.get(p.id);
  }

  @Put(':id')
  @ResponseSchema(quotationSchema)
  @References({ id: 'quotation', ...ITEM_REFS })
  @RequirePermission('quotations.write')
  update(
    @Param(idPipe()) p: IdParams,
    @Body(new ZodValidationPipe(updateQuotationRequestSchema)) body: UpdateQuotationRequest,
    @Req() req: Request,
  ) {
    return this.quotations.update(p.id, body, clientIp(req, this.env));
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(quotationSchema)
  @References({ id: 'quotation' })
  @RequirePermission('quotations.write')
  send(@Param(idPipe()) p: IdParams, @Req() req: Request) {
    return this.quotations.send(p.id, clientIp(req, this.env));
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(quotationSchema)
  @References({ id: 'quotation' })
  @RequirePermission('quotations.write')
  accept(@Param(idPipe()) p: IdParams, @Req() req: Request) {
    return this.quotations.decide(p.id, true, clientIp(req, this.env));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(quotationSchema)
  @References({ id: 'quotation' })
  @RequirePermission('quotations.write')
  reject(@Param(idPipe()) p: IdParams, @Req() req: Request) {
    return this.quotations.decide(p.id, false, clientIp(req, this.env));
  }

  @Post(':id/revise')
  @ResponseSchema(quotationSchema)
  @References({ id: 'quotation' })
  @RequirePermission('quotations.write')
  revise(@Param(idPipe()) p: IdParams, @Req() req: Request) {
    return this.quotations.revise(p.id, clientIp(req, this.env));
  }
}
