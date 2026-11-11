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
  customerMeResponseSchema,
  customerOtpStartRequestSchema,
  customerOtpVerifyRequestSchema,
  type CustomerOtpVerifyRequest,
} from '@tahi/validation';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { clientIp } from '../../../core/auth/client-ip.js';
import { SESSION_COOKIES, readCookie } from '../../../core/auth/cookies.js';
import { issueCsrfToken } from '../../../core/auth/csrf.js';
import { Authenticated, Public, Realm } from '../../../core/auth/decorators.js';
import { clearSessionCookie, setSessionCookie } from '../../../core/auth/session-cookie.js';
import { SessionService } from '../../../core/auth/session.service.js';
import { ENV } from '../../../core/config/config.module.js';
import type { Env } from '../../../core/config/env.js';
import { requireContext, type RequestContext } from '../../../core/context/request-context.js';
import { ResponseSchema } from '../../../core/http/contract.js';
import { ZodValidationPipe } from '../../../core/http/zod-validation.pipe.js';
import { CustomerAuthService, type RequestMeta } from './customer-auth.service.js';

/** Storefront customer sign-in; the atelier comes from the Host (realm "customer"). */
@Controller('customer/auth')
@Realm('customer')
export class CustomerAuthController {
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly sessions: SessionService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private meta(req: Request): RequestMeta {
    const ua = req.headers['user-agent'];
    return { ip: clientIp(req, this.env), ...(ua ? { userAgent: ua } : {}) };
  }

  @Get('csrf')
  @ResponseSchema(csrfResponseSchema)
  @Public()
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return { csrfToken: issueCsrfToken(req, res) };
  }

  @Post('start')
  @ResponseSchema(acceptedResponseSchema)
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async start(
    @Body(new ZodValidationPipe(customerOtpStartRequestSchema)) body: { email: string },
    @Req() req: Request,
  ) {
    await this.auth.start(body.email, this.meta(req));
    return { status: 'accepted' };
  }

  @Post('verify')
  @ResponseSchema(customerMeResponseSchema)
  @Public()
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body(new ZodValidationPipe(customerOtpVerifyRequestSchema)) body: CustomerOtpVerifyRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const presented = await this.sessions.resolve(
      'CUSTOMER',
      readCookie(req.headers.cookie, SESSION_COOKIES.CUSTOMER),
    );
    const r = await this.auth.verify(body, presented?.id, this.meta(req));
    setSessionCookie(res, 'CUSTOMER', r.token);
    return r.me;
  }

  @Get('me')
  @ResponseSchema(customerMeResponseSchema)
  @Authenticated()
  async me() {
    return this.auth.me();
  }

  @Post('logout')
  @ResponseSchema(acceptedResponseSchema)
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    await this.auth.logout(requireContext(this.cls, 'sessionId'));
    clearSessionCookie(res, 'CUSTOMER');
    return { status: 'accepted' };
  }
}
