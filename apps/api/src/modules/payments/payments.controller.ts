import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { replacePaymentScheduleSchema } from '@tahi/shared';
import { createZodDto } from 'nestjs-zod';
import { TenantRoute } from '../../common/auth/decorators';
import { PaymentsService } from './payments.service';

class ReplaceScheduleDto extends createZodDto(replacePaymentScheduleSchema) {}

@Controller('projects/:projectId/payment-schedule')
@TenantRoute()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  schedule(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.payments.getSchedule(projectId);
  }

  @TenantRoute('payments:manage-schedule')
  @Put()
  replace(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() body: ReplaceScheduleDto) {
    return this.payments.replaceSchedule(projectId, body as never);
  }
}
