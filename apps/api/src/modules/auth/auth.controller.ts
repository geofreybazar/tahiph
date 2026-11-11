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
  acceptInvitationRequestSchema,
  emailOnlyRequestSchema,
  loginRequestSchema,
  meResponseSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  switchTenantRequestSchema,
  tokenRequestSchema,
  type AcceptInvitationRequest,
  type LoginRequest,
  type MeResponse,
  type RegisterRequest,
  type ResetPasswordRequest,
} from '@tahi/validation';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { clientIp } from '../../core/auth/client-ip.js';
import { SESSION_COOKIES, readCookie } from '../../core/auth/cookies.js';
import { issueCsrfToken } from '../../core/auth/csrf.js';
import { Authenticated, Public, Realm } from '../../core/auth/decorators.js';
import { clearSessionCookie, setSessionCookie } from '../../core/auth/session-cookie.js';
import { SessionService } from '../../core/auth/session.service.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { AuthService, type RequestMeta, type StartedSession } from './auth.service.js';

const ACCEPTED = { status: 'accepted' } as const;

/** Staff authentication on the dashboard host (realm "tenant"). */
@Controller('auth')
@Realm('tenant')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private meta(req: Request): RequestMeta {
    const ua = req.headers['user-agent'];
    return { ip: clientIp(req, this.env), ...(ua ? { userAgent: ua } : {}) };
  }

  private async respondWithSession(res: Response, started: StartedSession): Promise<MeResponse> {
    setSessionCookie(res, 'TENANT', started.token);
    return meResponseSchema.parse(await this.auth.meForSession(started));
  }

  /** Issues the double-submit CSRF token; call before the first state-changing request. */
  @Get('csrf')
  @Public()
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return { csrfToken: issueCsrfToken(req, res) };
  }

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
    @Req() req: Request,
  ) {
    await this.auth.register(body, this.meta(req));
    return ACCEPTED;
  }

  @Post('resend-verification')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async resend(
    @Body(new ZodValidationPipe(emailOnlyRequestSchema)) body: { email: string },
    @Req() req: Request,
  ) {
    await this.auth.resendVerification(body.email, this.meta(req));
    return ACCEPTED;
  }

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body(new ZodValidationPipe(tokenRequestSchema)) body: { token: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respondWithSession(res, await this.auth.verifyEmail(body.token, this.meta(req)));
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const started = await this.auth.login(body, this.meta(req));
    await this.revokePresentedSession(req);
    return this.respondWithSession(res, started);
  }

  @Post('logout')
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    await this.auth.logout(requireContext(this.cls, 'sessionId'));
    clearSessionCookie(res, 'TENANT');
    return ACCEPTED;
  }

  @Get('me')
  @Authenticated()
  async me() {
    return meResponseSchema.parse(
      await this.auth.me(
        requireContext(this.cls, 'userId'),
        this.cls.get('membershipId'),
        this.cls.get('permissions') ?? [],
      ),
    );
  }

  @Post('switch-tenant')
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  async switchTenant(
    @Body(new ZodValidationPipe(switchTenantRequestSchema)) body: { membershipId: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const started = await this.auth.switchTenant(
      requireContext(this.cls, 'userId'),
      requireContext(this.cls, 'sessionId'),
      body.membershipId,
      this.meta(req),
    );
    return this.respondWithSession(res, started);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async forgot(
    @Body(new ZodValidationPipe(emailOnlyRequestSchema)) body: { email: string },
    @Req() req: Request,
  ) {
    await this.auth.forgotPassword(body.email, this.meta(req));
    return ACCEPTED;
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  async reset(
    @Body(new ZodValidationPipe(resetPasswordRequestSchema)) body: ResetPasswordRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.resetPassword(body, this.meta(req));
    clearSessionCookie(res, 'TENANT');
    return ACCEPTED;
  }

  /** Public, because new users have no session; an existing session is honoured if present. */
  @Post('accept-invitation')
  @Public()
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(
    @Body(new ZodValidationPipe(acceptInvitationRequestSchema)) body: AcceptInvitationRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const current = await this.sessions.resolve(
      'TENANT',
      readCookie(req.headers.cookie, SESSION_COOKIES.TENANT),
    );
    const started = await this.auth.acceptInvitation(body, current?.subjectId, this.meta(req));
    if (current) await this.sessions.revoke(current.id);
    return this.respondWithSession(res, started);
  }

  /** Login rotates: a session presented with the login request is ended. */
  private async revokePresentedSession(req: Request): Promise<void> {
    const current = await this.sessions.resolve(
      'TENANT',
      readCookie(req.headers.cookie, SESSION_COOKIES.TENANT),
    );
    if (current) await this.sessions.revoke(current.id);
  }
}
