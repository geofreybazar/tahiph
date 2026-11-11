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
  Query,
  Req,
} from '@nestjs/common';
import {
  appointmentListQuerySchema,
  appointmentParamsSchema,
  appointmentSchema,
  appointmentTypeParamsSchema,
  appointmentTypeSchema,
  cancelAppointmentRequestSchema,
  createAppointmentRequestSchema,
  createAppointmentTypeRequestSchema,
  createTimeOffRequestSchema,
  operatingHoursRequestSchema,
  operatingHoursSchema,
  rescheduleAppointmentRequestSchema,
  slotQuerySchema,
  slotsSchema,
  staffAvailabilityParamsSchema,
  timeOffParamsSchema,
  timeOffSchema,
  updateAppointmentTypeRequestSchema,
  type AppointmentListQuery,
  type CancelAppointmentRequest,
  type CreateAppointmentRequest,
  type CreateAppointmentTypeRequest,
  type CreateTimeOffRequest,
  type OperatingHoursRequest,
  type RescheduleAppointmentRequest,
  type SlotQuery,
  type UpdateAppointmentTypeRequest,
} from '@tahi/validation';
import type { Request } from 'express';
import { z } from 'zod';
import { clientIp } from '../../core/auth/client-ip.js';
import { Realm, RequirePermission } from '../../core/auth/decorators.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { References, ResponseSchema } from '../../core/http/contract.js';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { AppointmentsService } from './appointments.service.js';

type IdParams = { id: string };
type MemberParams = { membershipId: string };

@Controller('tenant/appointment-types')
@Realm('tenant')
export class AppointmentTypesController {
  constructor(
    private readonly appointments: AppointmentsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ResponseSchema(z.array(appointmentTypeSchema))
  @RequirePermission('appointments.read')
  list() {
    return this.appointments.listTypes();
  }

  @Post()
  @ResponseSchema(appointmentTypeSchema)
  @RequirePermission('appointments.manage_settings')
  create(
    @Body(new ZodValidationPipe(createAppointmentTypeRequestSchema))
    body: CreateAppointmentTypeRequest,
    @Req() req: Request,
  ) {
    return this.appointments.createType(body, clientIp(req, this.env));
  }

  @Patch(':id')
  @ResponseSchema(appointmentTypeSchema)
  @References({ id: 'appointmentType' })
  @RequirePermission('appointments.manage_settings')
  update(
    @Param(new ZodValidationPipe(appointmentTypeParamsSchema)) p: IdParams,
    @Body(new ZodValidationPipe(updateAppointmentTypeRequestSchema))
    body: UpdateAppointmentTypeRequest,
    @Req() req: Request,
  ) {
    return this.appointments.updateType(p.id, body, clientIp(req, this.env));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(appointmentTypeSchema)
  @References({ id: 'appointmentType' })
  @RequirePermission('appointments.manage_settings')
  archive(
    @Param(new ZodValidationPipe(appointmentTypeParamsSchema)) p: IdParams,
    @Req() req: Request,
  ) {
    return this.appointments.setTypeArchived(p.id, true, clientIp(req, this.env));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(appointmentTypeSchema)
  @References({ id: 'appointmentType' })
  @RequirePermission('appointments.manage_settings')
  restore(
    @Param(new ZodValidationPipe(appointmentTypeParamsSchema)) p: IdParams,
    @Req() req: Request,
  ) {
    return this.appointments.setTypeArchived(p.id, false, clientIp(req, this.env));
  }
}

/** Working hours and time off of one staff member. */
@Controller('tenant/staff/:membershipId')
@Realm('tenant')
export class StaffScheduleController {
  constructor(
    private readonly appointments: AppointmentsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('availability')
  @ResponseSchema(operatingHoursSchema)
  @References({ membershipId: 'staffMember' })
  @RequirePermission('appointments.read')
  availability(@Param(new ZodValidationPipe(staffAvailabilityParamsSchema)) p: MemberParams) {
    return this.appointments.availability(p.membershipId);
  }

  @Put('availability')
  @ResponseSchema(operatingHoursSchema)
  @References({ membershipId: 'staffMember' })
  @RequirePermission('appointments.manage_settings')
  replaceAvailability(
    @Param(new ZodValidationPipe(staffAvailabilityParamsSchema)) p: MemberParams,
    @Body(new ZodValidationPipe(operatingHoursRequestSchema)) body: OperatingHoursRequest,
    @Req() req: Request,
  ) {
    return this.appointments.replaceAvailability(p.membershipId, body, clientIp(req, this.env));
  }

  @Get('time-off')
  @ResponseSchema(z.array(timeOffSchema))
  @References({ membershipId: 'staffMember' })
  @RequirePermission('appointments.read')
  timeOff(@Param(new ZodValidationPipe(staffAvailabilityParamsSchema)) p: MemberParams) {
    return this.appointments.timeOff(p.membershipId);
  }

  @Post('time-off')
  @ResponseSchema(timeOffSchema)
  @References({ membershipId: 'staffMember' })
  @RequirePermission('appointments.manage_settings')
  addTimeOff(
    @Param(new ZodValidationPipe(staffAvailabilityParamsSchema)) p: MemberParams,
    @Body(new ZodValidationPipe(createTimeOffRequestSchema)) body: CreateTimeOffRequest,
    @Req() req: Request,
  ) {
    return this.appointments.addTimeOff(p.membershipId, body, clientIp(req, this.env));
  }

  @Delete('time-off/:timeOffId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema(z.null())
  @References({ membershipId: 'staffMember', timeOffId: 'timeOff' })
  @RequirePermission('appointments.manage_settings')
  deleteTimeOff(
    @Param(new ZodValidationPipe(timeOffParamsSchema)) p: MemberParams & { timeOffId: string },
    @Req() req: Request,
  ) {
    return this.appointments.deleteTimeOff(p.membershipId, p.timeOffId, clientIp(req, this.env));
  }
}

@Controller('tenant/appointments')
@Realm('tenant')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ResponseSchema(z.array(appointmentSchema))
  @References({ clientId: 'client', staffMembershipId: 'staffMember' })
  @RequirePermission('appointments.read')
  list(@Query(new ZodValidationPipe(appointmentListQuerySchema)) query: AppointmentListQuery) {
    return this.appointments.list(query);
  }

  // Declared before ':id' so "slots" is not read as an id.
  @Get('slots')
  @ResponseSchema(slotsSchema)
  @References({ typeId: 'appointmentType', staffMembershipId: 'staffMember' })
  @RequirePermission('appointments.read')
  slots(@Query(new ZodValidationPipe(slotQuerySchema)) query: SlotQuery) {
    return this.appointments.slots(query);
  }

  @Get(':id')
  @ResponseSchema(appointmentSchema)
  @References({ id: 'appointment' })
  @RequirePermission('appointments.read')
  get(@Param(new ZodValidationPipe(appointmentParamsSchema)) p: IdParams) {
    return this.appointments.get(p.id);
  }

  @Post()
  @ResponseSchema(appointmentSchema)
  @References({ clientId: 'client', typeId: 'appointmentType', staffMembershipId: 'staffMember' })
  @RequirePermission('appointments.write')
  create(
    @Body(new ZodValidationPipe(createAppointmentRequestSchema)) body: CreateAppointmentRequest,
    @Req() req: Request,
  ) {
    return this.appointments.create(body, clientIp(req, this.env));
  }

  @Post(':id/reschedule')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(appointmentSchema)
  @References({ id: 'appointment', staffMembershipId: 'staffMember' })
  @RequirePermission('appointments.write')
  reschedule(
    @Param(new ZodValidationPipe(appointmentParamsSchema)) p: IdParams,
    @Body(new ZodValidationPipe(rescheduleAppointmentRequestSchema))
    body: RescheduleAppointmentRequest,
    @Req() req: Request,
  ) {
    return this.appointments.reschedule(p.id, body, clientIp(req, this.env));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(appointmentSchema)
  @References({ id: 'appointment' })
  @RequirePermission('appointments.write')
  cancel(
    @Param(new ZodValidationPipe(appointmentParamsSchema)) p: IdParams,
    @Body(new ZodValidationPipe(cancelAppointmentRequestSchema)) body: CancelAppointmentRequest,
    @Req() req: Request,
  ) {
    return this.appointments.transition(p.id, 'CANCELLED', clientIp(req, this.env), body.reason);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(appointmentSchema)
  @References({ id: 'appointment' })
  @RequirePermission('appointments.write')
  complete(
    @Param(new ZodValidationPipe(appointmentParamsSchema)) p: IdParams,
    @Req() req: Request,
  ) {
    return this.appointments.transition(p.id, 'COMPLETED', clientIp(req, this.env));
  }

  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(appointmentSchema)
  @References({ id: 'appointment' })
  @RequirePermission('appointments.write')
  noShow(@Param(new ZodValidationPipe(appointmentParamsSchema)) p: IdParams, @Req() req: Request) {
    return this.appointments.transition(p.id, 'NO_SHOW', clientIp(req, this.env));
  }
}
