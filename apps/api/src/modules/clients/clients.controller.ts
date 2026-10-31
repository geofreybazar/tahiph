import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { clientInputSchema, listClientsSchema } from '@tahi/shared';
import { createZodDto } from 'nestjs-zod';
import { TenantRoute } from '../../common/auth/decorators';
import { ClientsService } from './clients.service';

class ClientInputDto extends createZodDto(clientInputSchema) {}
class ListClientsDto extends createZodDto(listClientsSchema) {}

@Controller('clients')
@TenantRoute()
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(@Query() query: ListClientsDto) {
    return this.clients.list(query as never);
  }

  @Post()
  create(@Body() body: ClientInputDto) {
    return this.clients.create(body as never);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: ClientInputDto) {
    return this.clients.update(id, body as never);
  }

  @TenantRoute('records:archive')
  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.archive(id);
  }
}
