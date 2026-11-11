import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { withUserScope, type DatabaseClient } from '@tahi/database';
import type {
  AcceptInvitationRequest,
  LoginRequest,
  MeResponse,
  RegisterRequest,
  ResetPasswordRequest,
} from '@tahi/validation';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../../core/audit/audit.service.js';
import { AuthTokenService } from '../../core/auth/auth-token.service.js';
import { hashPassword, verifyPassword } from '../../core/auth/password.js';
import { LIMITS, RateLimiter } from '../../core/auth/rate-limit.js';
import { SessionService } from '../../core/auth/session.service.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { UNSCOPED_PRISMA } from '../../core/database/tokens.js';
import { MAILER, type Mailer } from '../../core/email/email.types.js';
import {
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
} from '../../core/http/domain-error.js';
import * as emails from './emails.js';

/** Tenant statuses whose members can work in the dashboard. */
const OPERATIONAL_TENANT = new Set(['TRIAL', 'ACTIVE', 'PAST_DUE']);

const inviteMetadataSchema = z.object({ roleId: z.uuid() });

export interface RequestMeta {
  ip: string;
  userAgent?: string;
}

export interface StartedSession {
  token: string;
  sessionId: string;
  userId: string;
}

export class InvalidCredentialsError extends DomainError {
  constructor() {
    super('INVALID_CREDENTIALS', 'The email or password is incorrect.', HttpStatus.UNAUTHORIZED);
  }
}

export class InvalidTokenError extends DomainError {
  constructor() {
    super('INVALID_TOKEN', 'This link is invalid or has expired.', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/**
 * Staff authentication flows (docs/AUTHENTICATION_AND_AUTHORIZATION.md §3). Responses never
 * reveal whether an email is registered: register and forgot-password always return 202.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  /** Verified against for unknown emails, so timing does not reveal account existence. */
  private dummyHash = '';

  constructor(
    @Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly sessions: SessionService,
    private readonly tokens: AuthTokenService,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hashPassword(randomBytes(16).toString('hex'));
  }

  private link(path: string, token?: string): string {
    return `${this.env.APP_PUBLIC_URL}${path}${token ? `?token=${token}` : ''}`;
  }

  /** Queue an email without failing the request; the user can ask for a new link. */
  private async sendSafely(message: Parameters<Mailer['send']>[0], kind: string): Promise<void> {
    try {
      await this.mailer.send(message);
    } catch (err) {
      this.logger.error({ err, kind }, 'failed to enqueue email');
    }
  }

  private async throttleEmailSend(email: string, meta: RequestMeta): Promise<void> {
    await this.limiter.consume(`send:ip:${meta.ip}`, LIMITS.emailSendPerIp);
    await this.limiter.consume(`send:email:${email}`, LIMITS.emailSendPerAddress);
  }

  // --- Registration and verification -------------------------------------------------------

  async register(input: RegisterRequest, meta: RequestMeta): Promise<void> {
    await this.throttleEmailSend(input.email, meta);
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      if (existing.status === 'PENDING_VERIFICATION') {
        await this.sendVerification(existing.id, existing.email, existing.name);
      } else {
        await this.sendSafely(
          emails.accountExists(existing.email, this.link('/login'), this.link('/forgot-password')),
          'account-exists',
        );
      }
      return;
    }
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        status: 'PENDING_VERIFICATION',
      },
    });
    await this.audit.platformSafe({
      actorType: 'USER',
      actorId: user.id,
      action: 'user.registered',
      ip: meta.ip,
    });
    await this.sendVerification(user.id, user.email, user.name);
  }

  async resendVerification(email: string, meta: RequestMeta): Promise<void> {
    await this.throttleEmailSend(email, meta);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.status === 'PENDING_VERIFICATION')
      await this.sendVerification(user.id, user.email, user.name);
  }

  private async sendVerification(userId: string, email: string, name: string): Promise<void> {
    await this.tokens.revokeOutstanding('VERIFY_EMAIL', userId);
    const { token } = await this.tokens.issue({
      purpose: 'VERIFY_EMAIL',
      subjectId: userId,
      email,
    });
    await this.sendSafely(
      emails.verifyEmail(email, name, this.link('/verify-email', token)),
      'verify-email',
    );
  }

  async verifyEmail(token: string, meta: RequestMeta): Promise<StartedSession> {
    await this.limiter.consume(`token:ip:${meta.ip}`, LIMITS.tokenPerIp);
    const t = await this.tokens.peek('VERIFY_EMAIL', token);
    if (!t?.subjectId) throw new InvalidTokenError();
    const userId = t.subjectId;
    const activated = await this.prisma.$transaction(async (tx) => {
      if (!(await this.tokens.consume(t.id, tx))) return false;
      const r = await tx.user.updateMany({
        where: { id: userId, status: 'PENDING_VERIFICATION' },
        data: { status: 'ACTIVE', emailVerifiedAt: new Date() },
      });
      return r.count === 1;
    });
    if (!activated) throw new InvalidTokenError();
    await this.audit.platformSafe({
      actorType: 'USER',
      actorId: userId,
      action: 'user.email_verified',
      ip: meta.ip,
    });
    return this.startSession(userId, meta);
  }

  // --- Login / logout ----------------------------------------------------------------------

  async login(input: LoginRequest, meta: RequestMeta): Promise<StartedSession> {
    await this.limiter.consume(`login:ip:${meta.ip}`, LIMITS.loginPerIp);
    await this.limiter.assertAccountNotLocked(input.email);

    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const result = await verifyPassword(user?.passwordHash ?? this.dummyHash, input.password);
    if (!user || !result.ok) {
      await this.limiter.recordLoginFailure(input.email);
      await this.audit.platformSafe({
        actorType: 'USER',
        actorId: user?.id ?? null,
        action: 'auth.login_failed',
        ip: meta.ip,
      });
      throw new InvalidCredentialsError();
    }
    await this.limiter.clearLoginFailures(input.email);

    // Only reached with the correct password, so these do not enable enumeration.
    if (user.status === 'PENDING_VERIFICATION') {
      throw new ForbiddenError('EMAIL_NOT_VERIFIED', 'Confirm your email address first.');
    }
    if (user.status !== 'ACTIVE')
      throw new ForbiddenError('ACCOUNT_DISABLED', 'This account is disabled.');

    if (result.needsRehash) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(input.password) },
      });
    }
    await this.audit.platformSafe({
      actorType: 'USER',
      actorId: user.id,
      action: 'auth.login',
      ip: meta.ip,
    });
    return this.startSession(user.id, meta);
  }

  /** New session (rotation). Selects the active membership when exactly one is usable. */
  async startSession(
    userId: string,
    meta: RequestMeta,
    membershipId?: string,
  ): Promise<StartedSession> {
    const usable = (await this.listMemberships(userId)).filter(
      (m) => m.status === 'ACTIVE' && OPERATIONAL_TENANT.has(m.atelier.status),
    );
    const chosen = membershipId
      ? usable.find((m) => m.membershipId === membershipId)
      : usable.length === 1
        ? usable[0]
        : undefined;
    if (membershipId && !chosen) throw new NotFoundError();
    const s = await this.sessions.create({
      realm: 'TENANT',
      subjectId: userId,
      ...(chosen ? { tenantId: chosen.atelier.id, activeMembershipId: chosen.membershipId } : {}),
      ip: meta.ip,
      ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
    });
    return { token: s.token, sessionId: s.id, userId };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  /** Switching ateliers re-validates the membership and rotates the session. */
  async switchTenant(
    userId: string,
    currentSessionId: string,
    membershipId: string,
    meta: RequestMeta,
  ): Promise<StartedSession> {
    const started = await this.startSession(userId, meta, membershipId);
    await this.sessions.revoke(currentSessionId);
    return started;
  }

  // --- Who am I ----------------------------------------------------------------------------

  async listMemberships(userId: string): Promise<MeResponse['memberships']> {
    const rows = await withUserScope(this.prisma, userId, (tx) =>
      tx.tenantMembership.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          role: { select: { key: true, name: true } },
          tenant: { select: { id: true, name: true, slug: true, status: true } },
        },
      }),
    );
    return rows.map((m) => ({
      membershipId: m.id,
      status: m.status,
      atelier: m.tenant,
      role: m.role,
    }));
  }

  /** Profile for a session just started (no request context yet for its tenant). */
  async meForSession(started: StartedSession): Promise<MeResponse> {
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id: started.sessionId },
      select: { tenantId: true, activeMembershipId: true },
    });
    let permissions: string[] = [];
    const { tenantId, activeMembershipId } = session;
    if (tenantId && activeMembershipId) {
      permissions = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        const m = await tx.tenantMembership.findUnique({
          where: { id: activeMembershipId },
          select: { role: { select: { permissions: { select: { permission: true } } } } },
        });
        return m?.role.permissions.map((p) => p.permission) ?? [];
      });
    }
    return this.me(started.userId, activeMembershipId ?? undefined, permissions);
  }

  async me(
    userId: string,
    membershipId: string | undefined,
    permissions: Iterable<string>,
  ): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    return {
      user,
      activeMembershipId: membershipId ?? null,
      permissions: [...permissions].sort(),
      memberships: await this.listMemberships(userId),
    };
  }

  // --- Password reset ----------------------------------------------------------------------

  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    await this.throttleEmailSend(email, meta);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.status !== 'ACTIVE') return;
    await this.tokens.revokeOutstanding('PASSWORD_RESET', user.id);
    const { token } = await this.tokens.issue({
      purpose: 'PASSWORD_RESET',
      subjectId: user.id,
      email,
    });
    await this.sendSafely(
      emails.passwordReset(user.email, this.link('/reset-password', token)),
      'password-reset',
    );
  }

  async resetPassword(input: ResetPasswordRequest, meta: RequestMeta): Promise<void> {
    await this.limiter.consume(`token:ip:${meta.ip}`, LIMITS.tokenPerIp);
    const t = await this.tokens.peek('PASSWORD_RESET', input.token);
    if (!t?.subjectId) throw new InvalidTokenError();
    const userId = t.subjectId;
    const passwordHash = await hashPassword(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      if (!(await this.tokens.consume(t.id, tx))) return null;
      return tx.user.update({
        where: { id: userId },
        data: { passwordHash },
        select: { id: true, email: true },
      });
    });
    if (!user) throw new InvalidTokenError();
    await this.sessions.revokeAllForSubject('TENANT', user.id);
    await this.limiter.clearLoginFailures(user.email);
    await this.audit.platformSafe({
      actorType: 'USER',
      actorId: user.id,
      action: 'auth.password_reset',
      ip: meta.ip,
    });
    await this.sendSafely(emails.passwordChanged(user.email), 'password-changed');
  }

  // --- Invitations -------------------------------------------------------------------------

  /**
   * Accepts an invitation. An existing account must be signed in as the invited email; a new
   * account is created from name + password (the email is verified by the invitation link).
   */
  async acceptInvitation(
    input: AcceptInvitationRequest,
    signedInUserId: string | undefined,
    meta: RequestMeta,
  ): Promise<StartedSession> {
    await this.limiter.consume(`token:ip:${meta.ip}`, LIMITS.tokenPerIp);
    const t = await this.tokens.peek('INVITE', input.token);
    const parsed = inviteMetadataSchema.safeParse(t?.metadata);
    if (!t?.tenantId || !t.email || !parsed.success) throw new InvalidTokenError();
    const { tenantId, email } = t;
    const { roleId } = parsed.data;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    if (!tenant || !OPERATIONAL_TENANT.has(tenant.status)) throw new InvalidTokenError();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.id !== signedInUserId) {
        throw new UnauthenticatedError(
          'Sign in as the invited email address to accept this invitation.',
        );
      }
      if (existing.status !== 'ACTIVE')
        throw new ForbiddenError('ACCOUNT_DISABLED', 'This account is disabled.');
    } else if (!input.name || !input.password) {
      throw new DomainError(
        'ACCOUNT_DETAILS_REQUIRED',
        'Enter your name and a password to create your account.',
      );
    }
    const passwordHash = existing ? undefined : await hashPassword(input.password!);

    const result = await this.prisma.$transaction(async (tx) => {
      if (!(await this.tokens.consume(t.id, tx))) return null;
      const userId =
        existing?.id ??
        (
          await tx.user.create({
            data: {
              email,
              name: input.name!,
              passwordHash: passwordHash!,
              status: 'ACTIVE',
              emailVerifiedAt: new Date(),
            },
          })
        ).id;
      // Tenant rows are written under the invitation's tenant (RLS + composite FK on roleId).
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      const role = await tx.role.findFirst({
        where: { id: roleId, tenantId },
        select: { key: true },
      });
      // Throw (not return) so the token and any new user roll back with it.
      if (!role || role.key === 'owner') throw new InvalidTokenError();
      const already = await tx.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
      });
      if (already)
        throw new DomainError(
          'ALREADY_MEMBER',
          'You are already a member of this atelier.',
          HttpStatus.CONFLICT,
        );
      const membership = await tx.tenantMembership.create({
        data: { tenantId, userId, roleId, status: 'ACTIVE' },
      });
      await tx.tenantAuditLog.create({
        data: {
          tenantId,
          actorType: 'USER',
          actorId: userId,
          action: 'membership.invitation_accepted',
          targetType: 'membership',
          targetId: membership.id,
          ip: meta.ip,
        },
      });
      return { userId, membershipId: membership.id };
    });
    if (!result) throw new InvalidTokenError();
    return this.startSession(result.userId, meta, result.membershipId);
  }
}
