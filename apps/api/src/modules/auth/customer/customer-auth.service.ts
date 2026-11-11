import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { DatabaseClient, TenantDatabase } from '@tahi/database';
import type { CustomerMeResponse, CustomerOtpVerifyRequest } from '@tahi/validation';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../../../core/audit/audit.service.js';
import { AuthTokenService } from '../../../core/auth/auth-token.service.js';
import { LIMITS, RateLimiter } from '../../../core/auth/rate-limit.js';
import { SessionService } from '../../../core/auth/session.service.js';
import { ENV } from '../../../core/config/config.module.js';
import type { Env } from '../../../core/config/env.js';
import type { RequestContext } from '../../../core/context/request-context.js';
import { TENANT_DB } from '../../../core/database/tenant-database.provider.js';
import { UNSCOPED_PRISMA } from '../../../core/database/tokens.js';
import { MAILER, type Mailer } from '../../../core/email/email.types.js';
import {
  DomainError,
  ForbiddenError,
  UnauthenticatedError,
} from '../../../core/http/domain-error.js';
import { ClsService } from 'nestjs-cls';
import * as emails from '../emails.js';

/** Wrong codes allowed per issued code before it is burned. */
export const OTP_MAX_ATTEMPTS = 5;

const otpMetadataSchema = z.object({ salt: z.string(), codeHash: z.string() });
const codeHash = (salt: string, code: string) =>
  createHash('sha256').update(`${salt}:${code}`).digest('hex');

class InvalidCodeError extends DomainError {
  constructor() {
    super('INVALID_CODE', 'The code or link is invalid or has expired.', HttpStatus.UNAUTHORIZED);
  }
}

export interface RequestMeta {
  ip: string;
  userAgent?: string;
}

/**
 * Storefront customer sign-in (docs/AUTHENTICATION_AND_AUTHORIZATION.md §3.5). Passwordless:
 * a 6-digit code and a magic link, both from one AUTH_TOKEN(CUSTOMER_OTP) row. Signing in
 * creates the account on first use. Accounts and sessions are bound to the host's atelier.
 */
@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);

  constructor(
    @Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient,
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly cls: ClsService<RequestContext>,
    private readonly tokens: AuthTokenService,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
  ) {}

  private tenant(): { tenantId: string; host: string } {
    const tenantId = this.cls.get('tenantId');
    const host = this.cls.get('host');
    if (!tenantId || !host) throw new Error('Request context is missing the storefront tenant');
    return { tenantId, host };
  }

  /** Always succeeds (no enumeration); sends a code unless the account is disabled. */
  async start(email: string, meta: RequestMeta): Promise<void> {
    const { tenantId, host } = this.tenant();
    await this.limiter.consume(`cust-send:ip:${meta.ip}`, LIMITS.emailSendPerIp);
    await this.limiter.consume(`cust-send:${tenantId}:${email}`, LIMITS.emailSendPerAddress);

    const existing = await this.tenantDb.db().customerAccount.findFirst({
      where: { email },
      select: { status: true },
    });
    if (existing?.status === 'DISABLED') return;

    // A new code replaces earlier unused ones for this email at this atelier.
    await this.prisma.authToken.updateMany({
      where: { purpose: 'CUSTOMER_OTP', tenantId, email, usedAt: null },
      data: { usedAt: new Date() },
    });
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const salt = randomBytes(16).toString('hex');
    const { token } = await this.tokens.issue({
      purpose: 'CUSTOMER_OTP',
      tenantId,
      email,
      metadata: { salt, codeHash: codeHash(salt, code) },
    });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true },
    });
    const origin = this.env.STOREFRONT_URL_TEMPLATE.replace('{host}', host);
    try {
      await this.mailer.send(
        emails.customerSignIn(email, tenant.name, code, `${origin}/account/verify?token=${token}`),
      );
    } catch (err) {
      this.logger.error({ err }, 'failed to enqueue customer sign-in email');
    }
  }

  async verify(
    input: CustomerOtpVerifyRequest,
    presentedSessionId: string | undefined,
    meta: RequestMeta,
  ) {
    const { tenantId } = this.tenant();
    await this.limiter.consume(`cust-verify:ip:${meta.ip}`, LIMITS.tokenPerIp);
    const otp =
      'token' in input
        ? await this.byLink(input.token, tenantId)
        : await this.byCode(input.email, input.code, tenantId);
    if (!otp || !(await this.tokens.consume(otp.id))) throw new InvalidCodeError();

    const account = await this.tenantDb.withTenantTx(async () => {
      const db = this.tenantDb.db();
      const found = await db.customerAccount.findFirst({ where: { email: otp.email } });
      if (found?.status === 'DISABLED')
        throw new ForbiddenError('ACCOUNT_DISABLED', 'This account is disabled.');
      const now = new Date();
      return found
        ? db.customerAccount.update({ where: { id: found.id }, data: { lastLoginAt: now } })
        : db.customerAccount.create({
            data: { email: otp.email, emailVerifiedAt: now, lastLoginAt: now } as never,
          });
    });

    if (presentedSessionId) await this.sessions.revoke(presentedSessionId);
    const session = await this.sessions.create({
      realm: 'CUSTOMER',
      subjectId: account.id,
      tenantId,
      ip: meta.ip,
      ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
    });
    await this.audit
      .tenant({
        actorType: 'CUSTOMER',
        actorId: account.id,
        action: 'customer.signed_in',
        ip: meta.ip,
      })
      .catch((err: unknown) => this.logger.error({ err }, 'audit write failed'));
    return { token: session.token, me: this.toMe(account) };
  }

  private async byLink(token: string, tenantId: string) {
    const t = await this.tokens.peek('CUSTOMER_OTP', token);
    // A link from another atelier's email does not work on this atelier's host.
    if (!t?.email || t.tenantId !== tenantId) return null;
    return { id: t.id, email: t.email };
  }

  private async byCode(email: string, code: string, tenantId: string) {
    const t = await this.prisma.authToken.findFirst({
      where: {
        purpose: 'CUSTOMER_OTP',
        tenantId,
        email,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    const meta = otpMetadataSchema.safeParse(t?.metadata);
    if (!t || !meta.success || t.attempts >= OTP_MAX_ATTEMPTS) return null;
    const expected = Buffer.from(meta.data.codeHash, 'hex');
    const actual = Buffer.from(codeHash(meta.data.salt, code), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      // Count the failure; the code is burned once attempts reach the limit.
      await this.prisma.authToken.updateMany({
        where: { id: t.id, attempts: { lt: OTP_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      });
      return null;
    }
    return { id: t.id, email };
  }

  async me(): Promise<CustomerMeResponse> {
    const id = this.cls.get('customerAccountId');
    if (!id) throw new UnauthenticatedError();
    const a = await this.tenantDb.db().customerAccount.findUnique({ where: { id } });
    if (!a) throw new UnauthenticatedError();
    return this.toMe(a);
  }

  private toMe(a: { id: string; email: string; name: string | null }): CustomerMeResponse {
    return { customer: { id: a.id, email: a.email, name: a.name } };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }
}
