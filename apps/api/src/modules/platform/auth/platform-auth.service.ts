import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { DatabaseClient } from '@tahi/database';
import { PLATFORM_ROLE_PERMISSIONS } from '@tahi/types';
import type { LoginRequest, MfaVerifiedResponse, PlatformMeResponse } from '@tahi/validation';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../../../core/audit/audit.service.js';
import { hashPassword, verifyPassword } from '../../../core/auth/password.js';
import { LIMITS, RateLimiter } from '../../../core/auth/rate-limit.js';
import { SessionService } from '../../../core/auth/session.service.js';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  otpauthUri,
  verifyTotp,
  base32Encode,
} from '../../../core/auth/totp.js';
import { SECRET_BOX, type SecretBox } from '../../../core/crypto/secret-box.js';
import { UNSCOPED_PRISMA } from '../../../core/database/tokens.js';
import {
  DomainError,
  ForbiddenError,
  UnauthenticatedError,
} from '../../../core/http/domain-error.js';

const PRE_MFA_SESSION_MS = 5 * 60_000;
const MFA_ATTEMPTS = { limit: 5, windowMs: 15 * 60_000 };

export interface RequestMeta {
  ip: string;
  userAgent?: string;
}

class InvalidCredentialsError extends DomainError {
  constructor() {
    super('INVALID_CREDENTIALS', 'The email or password is incorrect.', HttpStatus.UNAUTHORIZED);
  }
}

class InvalidMfaCodeError extends DomainError {
  constructor() {
    super(
      'INVALID_MFA_CODE',
      'The code is incorrect or was already used.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

const sha256 = (s: string) => new Uint8Array(createHash('sha256').update(s, 'utf8').digest());
/** AAD binds an encrypted TOTP secret to its admin row. */
const aad = (adminId: string) => `platform_user.mfa_secret:${adminId}`;

/**
 * Platform admin login: password, then TOTP (mandatory; enrollment on first login).
 * The password step yields a 5-minute session that only MFA endpoints accept.
 */
@Injectable()
export class PlatformAuthService implements OnModuleInit {
  private dummyHash = '';

  constructor(
    @Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hashPassword(randomBytes(16).toString('hex'));
  }

  async login(input: LoginRequest, meta: RequestMeta) {
    const account = `platform:${input.email}`;
    await this.limiter.consume(`platform-login:ip:${meta.ip}`, LIMITS.loginPerIp);
    await this.limiter.assertAccountNotLocked(account);
    const admin = await this.prisma.platformUser.findUnique({ where: { email: input.email } });
    const result = await verifyPassword(admin?.passwordHash ?? this.dummyHash, input.password);
    if (!admin || !result.ok) {
      await this.limiter.recordLoginFailure(account);
      await this.audit.platformSafe({
        actorType: 'PLATFORM_USER',
        actorId: admin?.id ?? null,
        action: 'platform.login_failed',
        ip: meta.ip,
      });
      throw new InvalidCredentialsError();
    }
    await this.limiter.clearLoginFailures(account);
    if (admin.status !== 'ACTIVE')
      throw new ForbiddenError('ACCOUNT_DISABLED', 'This account is disabled.');
    if (result.needsRehash) {
      await this.prisma.platformUser.update({
        where: { id: admin.id },
        data: { passwordHash: await hashPassword(input.password) },
      });
    }
    const session = await this.sessions.create({
      realm: 'PLATFORM',
      subjectId: admin.id,
      mfaVerified: false,
      maxLifetimeMs: PRE_MFA_SESSION_MS,
      ip: meta.ip,
      ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
    });
    await this.audit.platformSafe({
      actorType: 'PLATFORM_USER',
      actorId: admin.id,
      action: 'platform.password_ok',
      ip: meta.ip,
    });
    return {
      token: session.token,
      next: admin.mfaEnrolledAt ? ('mfa_verify' as const) : ('mfa_enroll' as const),
    };
  }

  /** Starts (or restarts) enrollment: a new pending secret, encrypted at rest. */
  async beginEnrollment(adminId: string): Promise<{ otpauthUri: string; secret: string }> {
    const admin = await this.prisma.platformUser.findUniqueOrThrow({ where: { id: adminId } });
    if (admin.mfaEnrolledAt) {
      throw new DomainError(
        'MFA_ALREADY_ENROLLED',
        'Two-factor authentication is already set up.',
        HttpStatus.CONFLICT,
      );
    }
    const secret = generateTotpSecret();
    await this.prisma.platformUser.update({
      where: { id: adminId },
      data: { mfaSecretEnc: this.box.encrypt(secret, aad(adminId)), mfaLastStep: null },
    });
    return { otpauthUri: otpauthUri(secret, admin.email), secret: base32Encode(secret) };
  }

  /**
   * Verifies a TOTP code (completing enrollment on first use) and replaces the pre-MFA session
   * with a full one. Each code is accepted once (replay protection via mfaLastStep).
   */
  async verifyCode(
    adminId: string,
    sessionId: string,
    code: string,
    meta: RequestMeta,
  ): Promise<{ token: string; recoveryCodes?: string[] }> {
    await this.limiter.consume(`mfa:session:${sessionId}`, MFA_ATTEMPTS);
    const admin = await this.prisma.platformUser.findUniqueOrThrow({ where: { id: adminId } });
    if (!admin.mfaSecretEnc) {
      throw new DomainError(
        'MFA_NOT_ENROLLED',
        'Set up two-factor authentication first.',
        HttpStatus.CONFLICT,
      );
    }
    const step = verifyTotp(this.box.decrypt(admin.mfaSecretEnc, aad(adminId)), code);
    if (step === null) {
      await this.audit.platformSafe({
        actorType: 'PLATFORM_USER',
        actorId: adminId,
        action: 'platform.mfa_failed',
        ip: meta.ip,
      });
      throw new InvalidMfaCodeError();
    }
    const enrolling = !admin.mfaEnrolledAt;
    const recoveryCodes = enrolling ? generateRecoveryCodes() : undefined;

    const accepted = await this.prisma.$transaction(async (tx) => {
      const r = await tx.platformUser.updateMany({
        where: {
          id: adminId,
          OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: BigInt(step) } }],
        },
        data: { mfaLastStep: BigInt(step), ...(enrolling ? { mfaEnrolledAt: new Date() } : {}) },
      });
      if (r.count !== 1) return false;
      if (recoveryCodes) {
        await tx.platformRecoveryCode.deleteMany({ where: { platformUserId: adminId } });
        await tx.platformRecoveryCode.createMany({
          data: recoveryCodes.map((c) => ({
            platformUserId: adminId,
            codeHash: sha256(normalizeRecoveryCode(c)),
          })),
        });
      }
      return true;
    });
    if (!accepted) throw new InvalidMfaCodeError();

    await this.audit.platformSafe({
      actorType: 'PLATFORM_USER',
      actorId: adminId,
      action: enrolling ? 'platform.mfa_enrolled' : 'platform.login',
      ip: meta.ip,
    });
    const token = await this.upgradeSession(adminId, sessionId, meta);
    return { token, ...(recoveryCodes ? { recoveryCodes } : {}) };
  }

  /** Uses a single-use recovery code instead of a TOTP code. */
  async useRecoveryCode(adminId: string, sessionId: string, code: string, meta: RequestMeta) {
    await this.limiter.consume(`mfa:session:${sessionId}`, MFA_ATTEMPTS);
    const admin = await this.prisma.platformUser.findUniqueOrThrow({ where: { id: adminId } });
    if (!admin.mfaEnrolledAt) throw new InvalidMfaCodeError();
    const r = await this.prisma.platformRecoveryCode.updateMany({
      where: {
        platformUserId: adminId,
        codeHash: sha256(normalizeRecoveryCode(code)),
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });
    if (r.count !== 1) {
      await this.audit.platformSafe({
        actorType: 'PLATFORM_USER',
        actorId: adminId,
        action: 'platform.mfa_failed',
        ip: meta.ip,
      });
      throw new InvalidMfaCodeError();
    }
    const remaining = await this.prisma.platformRecoveryCode.count({
      where: { platformUserId: adminId, usedAt: null },
    });
    await this.audit.platformSafe({
      actorType: 'PLATFORM_USER',
      actorId: adminId,
      action: 'platform.login_recovery_code',
      ip: meta.ip,
      metadata: { remaining },
    });
    return { token: await this.upgradeSession(adminId, sessionId, meta), remaining };
  }

  private async upgradeSession(
    adminId: string,
    preSessionId: string,
    meta: RequestMeta,
  ): Promise<string> {
    await this.sessions.revoke(preSessionId);
    const s = await this.sessions.create({
      realm: 'PLATFORM',
      subjectId: adminId,
      mfaVerified: true,
      ip: meta.ip,
      ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
    });
    return s.token;
  }

  async me(adminId: string, mfaVerified: boolean): Promise<PlatformMeResponse> {
    const a = await this.prisma.platformUser.findUnique({
      where: { id: adminId },
      select: { id: true, email: true, name: true, role: true, mfaEnrolledAt: true },
    });
    if (!a) throw new UnauthenticatedError();
    return {
      admin: { id: a.id, email: a.email, name: a.name, role: a.role },
      mfa: { enrolled: a.mfaEnrolledAt !== null, verified: mfaVerified },
      permissions: mfaVerified ? [...PLATFORM_ROLE_PERMISSIONS[a.role]] : [],
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }
}

export type { MfaVerifiedResponse };
