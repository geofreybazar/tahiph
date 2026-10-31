import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  attachGarmentMediaSchema,
  garmentInputSchema,
  listGarmentsSchema,
  moveGarmentStageSchema,
} from '@tahi/shared';
import { createZodDto } from 'nestjs-zod';
import { TenantRoute } from '../../common/auth/decorators';
import { GarmentsService } from './garments.service';

class GarmentInputDto extends createZodDto(garmentInputSchema) {}
class MoveStageDto extends createZodDto(moveGarmentStageSchema) {}
class ListGarmentsDto extends createZodDto(listGarmentsSchema) {}
class AttachMediaDto extends createZodDto(attachGarmentMediaSchema) {}

@Controller()
@TenantRoute()
export class GarmentsController {
  constructor(private readonly garments: GarmentsService) {}

  @Get('garments')
  list(@Query() query: ListGarmentsDto) {
    return this.garments.list(query as never);
  }

  @Get('projects/:projectId/garments')
  listForProject(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.garments.listForProject(projectId);
  }

  @Post('projects/:projectId/garments')
  create(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() body: GarmentInputDto) {
    return this.garments.create(projectId, body as never);
  }

  @Get('garments/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.garments.get(id);
  }

  @Patch('garments/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: GarmentInputDto) {
    return this.garments.update(id, body as never);
  }

  @Post('garments/:id/stage')
  @HttpCode(200)
  moveStage(@Param('id', ParseUUIDPipe) id: string, @Body() body: MoveStageDto) {
    return this.garments.moveStage(id, body.stage, (body.note ?? null) as string | null);
  }

  @Get('garments/:id/stage-events')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.garments.history(id);
  }

  @Get('garments/:id/media')
  listMedia(@Param('id', ParseUUIDPipe) id: string) {
    return this.garments.listMedia(id);
  }

  @Post('garments/:id/media')
  attachMedia(@Param('id', ParseUUIDPipe) id: string, @Body() body: AttachMediaDto) {
    return this.garments.attachMedia(id, body.mediaFileId);
  }

  @Delete('garments/:id/media/:mediaFileId')
  @HttpCode(204)
  removeMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaFileId', ParseUUIDPipe) mediaFileId: string,
  ) {
    return this.garments.removeMedia(id, mediaFileId);
  }

  @TenantRoute('garments:delete')
  @Delete('garments/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.garments.remove(id);
  }
}
