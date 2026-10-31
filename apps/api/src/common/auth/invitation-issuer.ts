import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { IssuedInvitation } from '@tahi/shared';
import { PrismaClient, TenantRole } from '../../generated/prisma/client';
import { Env } from '../config/env';
import { ENV } from '../config/env.token';
import { ApiException } from '../http/api-exception';
import { BASE_PRISMA } from '../prisma/base-prisma.token';
import { AuthAdminService } from './auth-admin.service';

const VALID_DAYS = 7;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const invalid = () =>
  new ApiException(404, 'NOT_FOUND', 'This invitation is invalid or has expired');

/** Invitations are looked up by token before any tenant context exists, so this is unscoped. */
@Injectable()
export class InvitationIssuer {
  constructor(
    @Inject(BASE_PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly authAdmin: AuthAdminService,
  ) {}

  /** Callers must already have checked that the inviter may grant this role in this tenant. */
  async issue(
    tenantId: string,
    email: string,
    role: TenantRole,
    invitedByUserId: string,
  ): Promise<IssuedInvitation> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + VALID_DAYS * 24 * 60 * 60 * 1000);

    // An expired invitation mustn't block a new one through the one-open-per-email index.
    await this.prisma.tenantInvitation.deleteMany({
      where: { tenantId, email, acceptedAt: null, expiresAt: { lt: new Date() } },
    });
    let id: string;
    try {
      ({ id } = await this.prisma.tenantInvitation.create({
        data: { tenantId, email, role, tokenHash: hashToken(token), expiresAt, invitedByUserId },
      }));
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      throw new ApiException(409, 'CONFLICT', 'This email already has an open invitation');
    }

    const acceptUrl = `${this.env.ADMIN_APP_URL}/accept-invite?token=${token}`;
    const emailSent = await this.authAdmin.sendInvite(email, acceptUrl);
    return { id, email, role, expiresAt: expiresAt.toISOString(), acceptUrl, emailSent };
  }

  async accept(token: string, userId: string, email: string): Promise<{ tenantId: string }> {
    const invitation = await this.prisma.tenantInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { tenant: { select: { status: true } } },
    });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) throw invalid();

    if (invitation.email !== email) {
      throw new ApiException(403, 'FORBIDDEN', 'This invitation was sent to a different email');
    }
    if (!(await this.authAdmin.isEmailConfirmed(userId))) {
      throw new ApiException(403, 'FORBIDDEN', 'Confirm your email before accepting');
    }
    if (invitation.tenant.status !== 'active') {
      throw new ApiException(403, 'TENANT_SUSPENDED', 'This business is currently unavailable');
    }

    const { tenantId, role } = invitation;
    await this.prisma.$transaction(async (tx) => {
      // The conditional update means two simultaneous accepts can't both succeed.
      const claimed = await tx.tenantInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count === 0) throw invalid();

      const existing = await tx.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
      });
      if (existing?.status === 'active') {
        throw new ApiException(409, 'CONFLICT', 'You are already a member of this business');
      }
      await tx.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId, userId } },
        create: { tenantId, userId, role },
        update: { role, status: 'active' },
      });
    });
    return { tenantId };
  }
}
