import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseClient, SessionRealm } from '@tahi/database';
import { createHash, randomBytes } from 'node:crypto';
import { UNSCOPED_PRISMA } from '../database/tokens.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Idle (sliding) and absolute lifetimes (docs/AUTHENTICATION_AND_AUTHORIZATION.md §2). */
export const SESSION_LIFETIMES: Record<SessionRealm, { idleMs: number; absoluteMs: number }> = {
  TENANT: { idleMs: 7 * DAY, absoluteMs: 30 * DAY },
  PLATFORM: { idleMs: 30 * MINUTE, absoluteMs: 12 * 60 * MINUTE },
  CUSTOMER: { idleMs: 30 * DAY, absoluteMs: 90 * DAY },
};

/** lastSeenAt/expiresAt are written at most this often per session. */
const TOUCH_INTERVAL_MS = MINUTE;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface CreateSessionInput {
  realm: SessionRealm;
  subjectId: string;
  tenantId?: string;
  activeMembershipId?: string;
  mfaVerified?: boolean;
  ip?: string;
  userAgent?: string;
  /** Shorter lifetime than the realm default (e.g. a 5-minute pre-MFA session). */
  maxLifetimeMs?: number;
}

export interface ActiveSession {
  id: string;
  realm: SessionRealm;
  subjectId: string;
  tenantId: string | null;
  activeMembershipId: string | null;
  mfaVerifiedAt: Date | null;
  lastSeenAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export function hashToken(token: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(token, 'utf8').digest());
}

/**
 * Opaque server-side sessions (ADR-002). The raw token exists only in the cookie; the
 * database stores its SHA-256. Lookups go to PostgreSQL by unique index (ADR-019).
 */
@Injectable()
export class SessionService {
  constructor(@Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient) {}

  /** Creates a session and returns the raw token (set it as the realm's cookie). */
  async create(
    input: CreateSessionInput,
    now = new Date(),
  ): Promise<{ token: string; id: string }> {
    const token = randomBytes(32).toString('base64url');
    const base = SESSION_LIFETIMES[input.realm];
    const cap = input.maxLifetimeMs ?? Infinity;
    const life = { idleMs: Math.min(base.idleMs, cap), absoluteMs: Math.min(base.absoluteMs, cap) };
    const session = await this.prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        realm: input.realm,
        subjectId: input.subjectId,
        tenantId: input.tenantId ?? null,
        activeMembershipId: input.activeMembershipId ?? null,
        mfaVerifiedAt: input.mfaVerified ? now : null,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + Math.min(life.idleMs, life.absoluteMs)),
        absoluteExpiresAt: new Date(now.getTime() + life.absoluteMs),
      },
      select: { id: true },
    });
    return { token, id: session.id };
  }

  /** Returns the live session for a token of the given realm, or null. */
  async resolve(
    realm: SessionRealm,
    token: string | undefined,
    now = new Date(),
  ): Promise<ActiveSession | null> {
    if (!token || !TOKEN_PATTERN.test(token)) return null;
    const s = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        realm: true,
        subjectId: true,
        tenantId: true,
        activeMembershipId: true,
        mfaVerifiedAt: true,
        lastSeenAt: true,
        expiresAt: true,
        absoluteExpiresAt: true,
        revokedAt: true,
      },
    });
    if (!s || s.realm !== realm || s.revokedAt) return null;
    if (s.expiresAt <= now || s.absoluteExpiresAt <= now) return null;
    return s;
  }

  /** Slides the idle expiry (capped by the absolute expiry), at most once a minute. */
  async touch(session: ActiveSession, now = new Date()): Promise<void> {
    if (now.getTime() - session.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return;
    const idle = new Date(now.getTime() + SESSION_LIFETIMES[session.realm].idleMs);
    await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: {
        lastSeenAt: now,
        expiresAt: idle < session.absoluteExpiresAt ? idle : session.absoluteExpiresAt,
      },
    });
  }

  async revoke(sessionId: string, now = new Date()): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  /** Ends every staff session acting through one membership (member disabled). */
  async revokeForMembership(membershipId: string, now = new Date()): Promise<number> {
    const r = await this.prisma.session.updateMany({
      where: { realm: 'TENANT', activeMembershipId: membershipId, revokedAt: null },
      data: { revokedAt: now },
    });
    return r.count;
  }

  /** Mass revocation (password change, suspension, membership removal). */
  async revokeAllForSubject(
    realm: SessionRealm,
    subjectId: string,
    now = new Date(),
  ): Promise<number> {
    const r = await this.prisma.session.updateMany({
      where: { realm, subjectId, revokedAt: null },
      data: { revokedAt: now },
    });
    return r.count;
  }
}
