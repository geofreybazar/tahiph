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
  cancelOrderRequestSchema,
  convertQuotationRequestSchema,
  createOrderRequestSchema,
  orderListQuerySchema,
  orderParamsSchema,
  orderSchema,
  orderStatusRequestSchema,
  orderSummarySchema,
  updateOrderRequestSchema,
  type ConvertQuotationRequest,
  type CreateOrderRequest,
  type OrderListQuery,
  type OrderProgressStatus,
  type UpdateOrderRequest,
} from '@tahi/validation';
import type { Request } from 'express';
import { clientIp } from '../../core/auth/client-ip.js';
import { Realm, RequirePermission } from '../../core/auth/decorators.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { References, ResponseSchema } from '../../core/http/contract.js';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { ITEM_REFS } from '../quotations/quotations.controller.js';
import { OrdersService } from './orders.service.js';

type IdParams = { id: string };
const idPipe = () => new ZodValidationPipe(orderParamsSchema);

/** Orders (ADR-034). */
@Controller('tenant/orders')
@Realm('tenant')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ResponseSchema(orderSummarySchema, { paginated: true })
  @References({ clientId: 'client' })
  @RequirePermission('orders.read')
  list(@Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQuery) {
    return this.orders.list(query);
  }

  @Post()
  @ResponseSchema(orderSchema)
  @References({ clientId: 'client', ...ITEM_REFS })
  @RequirePermission('orders.write')
  create(
    @Body(new ZodValidationPipe(createOrderRequestSchema)) body: CreateOrderRequest,
    @Req() req: Request,
  ) {
    return this.orders.create(body, clientIp(req, this.env));
  }

  /** Idempotent: converting the same quotation again returns its order. */
  @Post('from-quotation')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(orderSchema)
  @References({ quotationId: 'quotation' })
  @RequirePermission('orders.write')
  convert(
    @Body(new ZodValidationPipe(convertQuotationRequestSchema)) body: ConvertQuotationRequest,
    @Req() req: Request,
  ) {
    return this.orders.convert(body, clientIp(req, this.env));
  }

  @Get(':id')
  @ResponseSchema(orderSchema)
  @References({ id: 'order' })
  @RequirePermission('orders.read')
  get(@Param(idPipe()) p: IdParams) {
    return this.orders.get(p.id);
  }

  @Put(':id')
  @ResponseSchema(orderSchema)
  @References({ id: 'order', ...ITEM_REFS })
  @RequirePermission('orders.write')
  update(
    @Param(idPipe()) p: IdParams,
    @Body(new ZodValidationPipe(updateOrderRequestSchema)) body: UpdateOrderRequest,
    @Req() req: Request,
  ) {
    return this.orders.update(p.id, body, clientIp(req, this.env));
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(orderSchema)
  @References({ id: 'order' })
  @RequirePermission('orders.write')
  progress(
    @Param(idPipe()) p: IdParams,
    @Body(new ZodValidationPipe(orderStatusRequestSchema)) body: { status: OrderProgressStatus },
    @Req() req: Request,
  ) {
    return this.orders.progress(p.id, body.status, clientIp(req, this.env));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(orderSchema)
  @References({ id: 'order' })
  @RequirePermission('orders.cancel')
  cancel(
    @Param(idPipe()) p: IdParams,
    @Body(new ZodValidationPipe(cancelOrderRequestSchema)) body: { reason: string },
    @Req() req: Request,
  ) {
    return this.orders.cancel(p.id, body.reason, clientIp(req, this.env));
  }
}
