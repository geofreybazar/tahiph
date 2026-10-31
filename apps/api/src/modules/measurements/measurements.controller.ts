import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { createMeasurementRecordSchema, measurementProfileInputSchema } from '@tahi/shared';
import { createZodDto } from 'nestjs-zod';
import { TenantRoute } from '../../common/auth/decorators';
import { MeasurementsService } from './measurements.service';

class ProfileInputDto extends createZodDto(measurementProfileInputSchema) {}
class CreateRecordDto extends createZodDto(createMeasurementRecordSchema) {}

@Controller()
@TenantRoute()
export class MeasurementsController {
  constructor(private readonly measurements: MeasurementsService) {}

  @Get('clients/:clientId/measurement-profiles')
  list(@Param('clientId', ParseUUIDPipe) clientId: string) {
    return this.measurements.listProfiles(clientId);
  }

  @Post('clients/:clientId/measurement-profiles')
  create(@Param('clientId', ParseUUIDPipe) clientId: string, @Body() body: ProfileInputDto) {
    return this.measurements.createProfile(clientId, body as never);
  }

  @Get('measurement-profiles/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.measurements.getProfile(id);
  }

  @Patch('measurement-profiles/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: ProfileInputDto) {
    return this.measurements.updateProfile(id, body as never);
  }

  @Post('measurement-profiles/:id/records')
  addRecord(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateRecordDto) {
    return this.measurements.addRecord(id, body as never);
  }

  @Get('measurement-records/:id')
  getRecord(@Param('id', ParseUUIDPipe) id: string) {
    return this.measurements.getRecord(id);
  }
}
