import { Inject, Injectable } from '@nestjs/common';
import type { AuthTokenPurpose, DatabaseClient, Prisma } from '@tahi/database';
import { randomBytes } from 'node:crypto';
import { UNSCOPED_PRISMA } from '../database/tokens.js';
import { hashToken } from './session.service.js';

const MIN = 60_000;

/** Lifetimes per purpose (docs/AUTHENTICATION_AND_AUTHORIZATION.md §3). */
export const AUTH_TOKEN_TTL_MS: Record<AuthTokenPurpose, number> = {
  VERIFY_EMAIL: 24 * 60 * MIN,
  PASSWORD_RESET: 30 * MIN,
  INVITE: 7 * 24 * 60 * MIN,
  CUSTOMER_OTP: 10 * MIN,
};

type Tx = Prisma.TransactionClient | DatabaseClient;

export interface IssueTokenInput {
  purpose: AuthTokenPurpose;
  subjectId?: string;
  tenantId?: string;
  email?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface ValidToken {
  id: string;
  subjectId: string | null;
  tenantId: string | null;
  email: string | null;
  metadata: Prisma.JsonValue;
  expiresAt: Date;
}

/** Single-use, hashed, short-lived tokens for email links. The raw token is only emailed. */
@Injectable()
export class AuthTokenService {
  constructor(@Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient) {}

  async issue(
    input: IssueTokenInput,
    now = new Date(),
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + AUTH_TOKEN_TTL_MS[input.purpose]);
    await this.prisma.authToken.create({
      data: {
        tokenHash: hashToken(token),
        purpose: input.purpose,
        subjectId: input.subjectId ?? null,
        tenantId: input.tenantId ?? null,
        email: input.email ?? null,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        expiresAt,
      },
    });
    return { token, expiresAt };
  }

  /** Looks up a usable token without consuming it. */
  async peek(
    purpose: AuthTokenPurpose,
    token: string,
    now = new Date(),
  ): Promise<ValidToken | null> {
    const row = await this.prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt <= now) return null;
    return row;
  }

  /**
   * Marks a token used. Returns false if it was already used or expired, so concurrent
   * requests cannot both redeem it. Pass a transaction to consume atomically with its effect.
   */
  async consume(id: string, tx: Tx = this.prisma, now = new Date()): Promise<boolean> {
    const r = await tx.authToken.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return r.count === 1;
  }

  /** Invalidates outstanding tokens of a purpose for a subject (e.g. older reset links). */
  async revokeOutstanding(
    purpose: AuthTokenPurpose,
    subjectId: string,
    now = new Date(),
  ): Promise<void> {
    await this.prisma.authToken.updateMany({
      where: { purpose, subjectId, usedAt: null },
      data: { usedAt: now },
    });
  }
}
