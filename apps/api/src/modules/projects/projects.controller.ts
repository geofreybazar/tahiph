import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  createProjectSchema,
  listProjectsSchema,
  updateProjectPriceSchema,
  updateProjectSchema,
  updateProjectStatusSchema,
} from '@tahi/shared';
import { createZodDto } from 'nestjs-zod';
import { TenantRoute } from '../../common/auth/decorators';
import { ProjectsService } from './projects.service';

class CreateProjectDto extends createZodDto(createProjectSchema) {}
class UpdateProjectDto extends createZodDto(updateProjectSchema) {}
class UpdatePriceDto extends createZodDto(updateProjectPriceSchema) {}
class UpdateStatusDto extends createZodDto(updateProjectStatusSchema) {}
class ListProjectsDto extends createZodDto(listProjectsSchema) {}

@Controller('projects')
@TenantRoute()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Query() query: ListProjectsDto) {
    return this.projects.list(query as never);
  }

  @Post()
  create(@Body() body: CreateProjectDto) {
    return this.projects.create(body as never);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateProjectDto) {
    return this.projects.update(id, body as never);
  }

  @TenantRoute('projects:change-price')
  @Patch(':id/price')
  changePrice(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePriceDto) {
    return this.projects.changePrice(id, body.priceCentavos);
  }

  @Post(':id/status')
  @HttpCode(200)
  changeStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateStatusDto) {
    return this.projects.changeStatus(id, body.status);
  }

  @TenantRoute('records:archive')
  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.archive(id);
  }
}

@Controller('clients/:clientId/projects')
@TenantRoute()
export class ClientProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Param('clientId', ParseUUIDPipe) clientId: string, @Query() query: ListProjectsDto) {
    return this.projects.listForClient(clientId, query as never);
  }
}
