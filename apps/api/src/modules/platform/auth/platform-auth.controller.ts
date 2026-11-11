import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  acceptedResponseSchema,
  csrfResponseSchema,
  loginRequestSchema,
  mfaEnrollmentResponseSchema,
  mfaVerifiedResponseSchema,
  platformLoginResponseSchema,
  platformMeResponseSchema,
  recoveryCodeRequestSchema,
  totpCodeRequestSchema,
  type LoginRequest,
} from '@tahi/validation';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { clientIp } from '../../../core/auth/client-ip.js';
import { issueCsrfToken } from '../../../core/auth/csrf.js';
import { AllowMfaPending, Authenticated, Public, Realm } from '../../../core/auth/decorators.js';
import { clearSessionCookie, setSessionCookie } from '../../../core/auth/session-cookie.js';
import { ENV } from '../../../core/config/config.module.js';
import type { Env } from '../../../core/config/env.js';
import { requireContext, type RequestContext } from '../../../core/context/request-context.js';
import { ResponseSchema } from '../../../core/http/contract.js';
import { ZodValidationPipe } from '../../../core/http/zod-validation.pipe.js';
import { PlatformAuthService, type RequestMeta } from './platform-auth.service.js';

/** Platform admin authentication on the admin host. */
@Controller('platform/auth')
@Realm('platform')
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private meta(req: Request): RequestMeta {
    const ua = req.headers['user-agent'];
    return { ip: clientIp(req, this.env), ...(ua ? { userAgent: ua } : {}) };
  }

  private adminId(): string {
    const id = this.cls.get('platformUserId');
    if (typeof id !== 'string') throw new Error('Request context is missing platformUserId');
    return id;
  }

  @Get('csrf')
  @ResponseSchema(csrfResponseSchema)
  @Public()
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return { csrfToken: issueCsrfToken(req, res) };
  }

  @Post('login')
  @ResponseSchema(platformLoginResponseSchema)
  @Public()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, next } = await this.auth.login(body, this.meta(req));
    setSessionCookie(res, 'PLATFORM', token);
    return { next };
  }

  @Post('mfa/enroll')
  @ResponseSchema(mfaEnrollmentResponseSchema)
  @Authenticated()
  @AllowMfaPending()
  @HttpCode(HttpStatus.OK)
  async enroll() {
    return this.auth.beginEnrollment(this.adminId());
  }

  @Post('mfa/verify')
  @ResponseSchema(mfaVerifiedResponseSchema)
  @Authenticated()
  @AllowMfaPending()
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body(new ZodValidationPipe(totpCodeRequestSchema)) body: { code: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const adminId = this.adminId();
    const r = await this.auth.verifyCode(
      adminId,
      requireContext(this.cls, 'sessionId'),
      body.code,
      this.meta(req),
    );
    setSessionCookie(res, 'PLATFORM', r.token);
    return {
      me: await this.auth.me(adminId, true),
      ...(r.recoveryCodes ? { recoveryCodes: r.recoveryCodes } : {}),
    };
  }

  @Post('mfa/recover')
  @ResponseSchema(mfaVerifiedResponseSchema)
  @Authenticated()
  @AllowMfaPending()
  @HttpCode(HttpStatus.OK)
  async recover(
    @Body(new ZodValidationPipe(recoveryCodeRequestSchema)) body: { code: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const adminId = this.adminId();
    const r = await this.auth.useRecoveryCode(
      adminId,
      requireContext(this.cls, 'sessionId'),
      body.code,
      this.meta(req),
    );
    setSessionCookie(res, 'PLATFORM', r.token);
    return {
      me: await this.auth.me(adminId, true),
      recoveryCodesRemaining: r.remaining,
    };
  }

  @Get('me')
  @ResponseSchema(platformMeResponseSchema)
  @Authenticated()
  @AllowMfaPending()
  async me() {
    return await this.auth.me(this.adminId(), this.cls.get('mfaVerified') === true);
  }

  @Post('logout')
  @ResponseSchema(acceptedResponseSchema)
  @Authenticated()
  @AllowMfaPending()
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    await this.auth.logout(requireContext(this.cls, 'sessionId'));
    clearSessionCookie(res, 'PLATFORM');
    return { status: 'accepted' };
  }
}
