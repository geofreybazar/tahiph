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
  Req,
  Res,
} from '@nestjs/common';
import {
  atelierCreatedResponseSchema,
  createAtelierRequestSchema,
  createInvitationRequestSchema,
  invitationCreatedResponseSchema,
  invitationParamsSchema,
  invitationSchema,
  staffMemberSchema,
  staffParamsSchema,
  updateStaffMemberRequestSchema,
  type CreateAtelierRequest,
  type CreateInvitationRequest,
  type UpdateStaffMemberRequest,
} from '@tahi/validation';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import { clientIp } from '../../core/auth/client-ip.js';
import { Authenticated, Realm, RequirePermission } from '../../core/auth/decorators.js';
import { setSessionCookie } from '../../core/auth/session-cookie.js';
import { SessionService } from '../../core/auth/session.service.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { References, ResponseSchema } from '../../core/http/contract.js';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { InvitationsService } from './invitations.service.js';
import { OnboardingService } from './onboarding.service.js';
import { StaffService } from './staff.service.js';

@Controller('onboarding')
@Realm('tenant')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly sessions: SessionService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Creates an atelier owned by the signed-in user and switches the session to it. */
  @Post('tenant')
  @ResponseSchema(atelierCreatedResponseSchema)
  @Authenticated()
  async create(
    @Body(new ZodValidationPipe(createAtelierRequestSchema)) body: CreateAtelierRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ua = req.headers['user-agent'];
    const result = await this.onboarding.createAtelier(requireContext(this.cls, 'userId'), body, {
      ip: clientIp(req, this.env),
      ...(ua ? { userAgent: ua } : {}),
    });
    await this.sessions.revoke(requireContext(this.cls, 'sessionId'));
    setSessionCookie(res, 'TENANT', result.session.token);
    // Never echo the session token: it travels only in the cookie.
    return {
      atelier: result.atelier,
      membershipId: result.membershipId,
      storefrontHost: result.storefrontHost,
    };
  }
}

@Controller('tenant/invitations')
@Realm('tenant')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post()
  @ResponseSchema(invitationCreatedResponseSchema)
  @References({ roleId: 'role' })
  @RequirePermission('staff.manage')
  async create(
    @Body(new ZodValidationPipe(createInvitationRequestSchema)) body: CreateInvitationRequest,
    @Req() req: Request,
  ) {
    return await this.invitations.invite(body, clientIp(req, this.env));
  }

  @Get()
  @ResponseSchema(z.array(invitationSchema))
  @RequirePermission('staff.manage')
  list() {
    return this.invitations.list();
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema(z.null())
  @References({ id: 'invitation' })
  @RequirePermission('staff.manage')
  revoke(
    @Param(new ZodValidationPipe(invitationParamsSchema)) params: { id: string },
    @Req() req: Request,
  ) {
    return this.invitations.revoke(params.id, clientIp(req, this.env));
  }
}

@Controller('tenant/staff')
@Realm('tenant')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ResponseSchema(z.array(staffMemberSchema))
  @RequirePermission('staff.read')
  list() {
    return this.staff.list();
  }

  @Patch(':membershipId')
  @ResponseSchema(staffMemberSchema)
  @References({ membershipId: 'staffMember', roleId: 'role' })
  @RequirePermission('staff.manage')
  update(
    @Param(new ZodValidationPipe(staffParamsSchema)) params: { membershipId: string },
    @Body(new ZodValidationPipe(updateStaffMemberRequestSchema)) body: UpdateStaffMemberRequest,
    @Req() req: Request,
  ) {
    return this.staff.update(params.membershipId, body, clientIp(req, this.env));
  }
}
