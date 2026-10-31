import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  appointmentInputSchema,
  appointmentStatusSchema,
  listAppointmentsSchema,
} from '@tahi/shared';
import { createZodDto } from 'nestjs-zod';
import { TenantRoute } from '../../common/auth/decorators';
import { AppointmentsService } from './appointments.service';

class AppointmentInputDto extends createZodDto(appointmentInputSchema) {}
class AppointmentStatusDto extends createZodDto(appointmentStatusSchema) {}
class ListAppointmentsDto extends createZodDto(listAppointmentsSchema) {}

@Controller('appointments')
@TenantRoute()
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  list(@Query() query: ListAppointmentsDto) {
    return this.appointments.list(query as never);
  }

  @Post()
  create(@Body() body: AppointmentInputDto) {
    return this.appointments.create(body as never);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: AppointmentInputDto) {
    return this.appointments.update(id, body as never);
  }

  @Post(':id/status')
  @HttpCode(200)
  changeStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: AppointmentStatusDto) {
    return this.appointments.changeStatus(id, body.status);
  }
}
