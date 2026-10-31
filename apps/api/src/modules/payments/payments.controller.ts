import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  idempotencyKeySchema,
  listPaymentsSchema,
  recordPaymentSchema,
  replacePaymentScheduleSchema,
  voidPaymentSchema,
} from '@tahi/shared';
import { createZodDto } from 'nestjs-zod';
import { TenantRoute } from '../../common/auth/decorators';
import { ApiException } from '../../common/http/api-exception';
import { PaymentsService } from './payments.service';

class ReplaceScheduleDto extends createZodDto(replacePaymentScheduleSchema) {}
class RecordPaymentDto extends createZodDto(recordPaymentSchema) {}
class VoidPaymentDto extends createZodDto(voidPaymentSchema) {}
class ListPaymentsDto extends createZodDto(listPaymentsSchema) {}

@Controller()
@TenantRoute()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('projects/:projectId/payment-schedule')
  schedule(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.payments.getSchedule(projectId);
  }

  @TenantRoute('payments:manage-schedule')
  @Put('projects/:projectId/payment-schedule')
  replace(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() body: ReplaceScheduleDto) {
    return this.payments.replaceSchedule(projectId, body as never);
  }

  @Get('projects/:projectId/payments')
  listForProject(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.payments.listForProject(projectId);
  }

  @Post('projects/:projectId/payments')
  record(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: RecordPaymentDto,
  ) {
    const parsed = idempotencyKeySchema.safeParse(key);
    if (!parsed.success) {
      throw new ApiException(400, 'BAD_REQUEST', 'A valid Idempotency-Key header is required');
    }
    return this.payments.record(projectId, parsed.data, body as never);
  }

  @Get('clients/:clientId/payments')
  listForClient(@Param('clientId', ParseUUIDPipe) clientId: string) {
    return this.payments.listForClient(clientId);
  }

  @TenantRoute('finance:read')
  @Get('payments')
  list(@Query() query: ListPaymentsDto) {
    return this.payments.list(query as never);
  }

  @TenantRoute('payments:void')
  @Post('payments/:id/void')
  @HttpCode(200)
  voidPayment(@Param('id', ParseUUIDPipe) id: string, @Body() body: VoidPaymentDto) {
    return this.payments.voidPayment(id, body.reason as string);
  }
}
