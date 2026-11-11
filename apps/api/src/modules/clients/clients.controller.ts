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
  Query,
  Req,
} from '@nestjs/common';
import {
  clientListQuerySchema,
  clientNoteParamsSchema,
  clientNoteSchema,
  clientParamsSchema,
  clientSchema,
  communicationSchema,
  createClientNoteRequestSchema,
  createClientRequestSchema,
  createCommunicationRequestSchema,
  updateClientRequestSchema,
  type ClientListQuery,
  type CreateClientNoteRequest,
  type CreateClientRequest,
  type CreateCommunicationRequest,
  type UpdateClientRequest,
} from '@tahi/validation';
import type { Request } from 'express';
import { z } from 'zod';
import { clientIp } from '../../core/auth/client-ip.js';
import { Realm, RequirePermission } from '../../core/auth/decorators.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { References, ResponseSchema } from '../../core/http/contract.js';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { ClientsService } from './clients.service.js';

type IdParams = { id: string };

/** CRM routes (ADR-026). */
@Controller('tenant/clients')
@Realm('tenant')
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ResponseSchema(clientSchema, { paginated: true })
  @RequirePermission('clients.read')
  list(@Query(new ZodValidationPipe(clientListQuerySchema)) query: ClientListQuery) {
    return this.clients.list(query);
  }

  @Post()
  @ResponseSchema(clientSchema)
  @RequirePermission('clients.write')
  create(
    @Body(new ZodValidationPipe(createClientRequestSchema)) body: CreateClientRequest,
    @Req() req: Request,
  ) {
    return this.clients.create(body, clientIp(req, this.env));
  }

  @Get(':id')
  @ResponseSchema(clientSchema)
  @References({ id: 'client' })
  @RequirePermission('clients.read')
  get(@Param(new ZodValidationPipe(clientParamsSchema)) p: IdParams) {
    return this.clients.get(p.id);
  }

  @Patch(':id')
  @ResponseSchema(clientSchema)
  @References({ id: 'client' })
  @RequirePermission('clients.write')
  update(
    @Param(new ZodValidationPipe(clientParamsSchema)) p: IdParams,
    @Body(new ZodValidationPipe(updateClientRequestSchema)) body: UpdateClientRequest,
    @Req() req: Request,
  ) {
    return this.clients.update(p.id, body, clientIp(req, this.env));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(clientSchema)
  @References({ id: 'client' })
  @RequirePermission('clients.archive')
  archive(@Param(new ZodValidationPipe(clientParamsSchema)) p: IdParams, @Req() req: Request) {
    return this.clients.setArchived(p.id, true, clientIp(req, this.env));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(clientSchema)
  @References({ id: 'client' })
  @RequirePermission('clients.archive')
  restore(@Param(new ZodValidationPipe(clientParamsSchema)) p: IdParams, @Req() req: Request) {
    return this.clients.setArchived(p.id, false, clientIp(req, this.env));
  }

  @Get(':id/notes')
  @ResponseSchema(z.array(clientNoteSchema))
  @References({ id: 'client' })
  @RequirePermission('clients.read')
  notes(@Param(new ZodValidationPipe(clientParamsSchema)) p: IdParams) {
    return this.clients.notes(p.id);
  }

  @Post(':id/notes')
  @ResponseSchema(clientNoteSchema)
  @References({ id: 'client' })
  @RequirePermission('clients.write')
  addNote(
    @Param(new ZodValidationPipe(clientParamsSchema)) p: IdParams,
    @Body(new ZodValidationPipe(createClientNoteRequestSchema)) body: CreateClientNoteRequest,
    @Req() req: Request,
  ) {
    return this.clients.addNote(p.id, body, clientIp(req, this.env));
  }

  @Delete(':id/notes/:noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema(z.null())
  @References({ id: 'client', noteId: 'clientNote' })
  @RequirePermission('clients.write')
  deleteNote(
    @Param(new ZodValidationPipe(clientNoteParamsSchema)) p: { id: string; noteId: string },
    @Req() req: Request,
  ) {
    return this.clients.deleteNote(p.id, p.noteId, clientIp(req, this.env));
  }

  @Get(':id/communications')
  @ResponseSchema(z.array(communicationSchema))
  @References({ id: 'client' })
  @RequirePermission('clients.read')
  communications(@Param(new ZodValidationPipe(clientParamsSchema)) p: IdParams) {
    return this.clients.communications(p.id);
  }

  @Post(':id/communications')
  @ResponseSchema(communicationSchema)
  @References({ id: 'client' })
  @RequirePermission('clients.write')
  addCommunication(
    @Param(new ZodValidationPipe(clientParamsSchema)) p: IdParams,
    @Body(new ZodValidationPipe(createCommunicationRequestSchema))
    body: CreateCommunicationRequest,
    @Req() req: Request,
  ) {
    return this.clients.addCommunication(p.id, body, clientIp(req, this.env));
  }
}
