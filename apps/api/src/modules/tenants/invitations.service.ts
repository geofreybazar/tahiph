import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { DatabaseClient, TenantDatabase } from '@tahi/database';
import type { CreateInvitationRequest } from '@tahi/validation';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../core/audit/audit.service.js';
import { AuthTokenService } from '../../core/auth/auth-token.service.js';
import { RateLimiter } from '../../core/auth/rate-limit.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { UNSCOPED_PRISMA } from '../../core/database/tokens.js';
import { MAILER, type Mailer } from '../../core/email/email.types.js';
import { DomainError, NotFoundError } from '../../core/http/domain-error.js';
import * as emails from '../auth/emails.js';

/** Staff invitations for the active atelier (docs/AUTHENTICATION_AND_AUTHORIZATION.md §3.4). */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient,
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly cls: ClsService<RequestContext>,
    private readonly tokens: AuthTokenService,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
  ) {}

  async invite(input: CreateInvitationRequest, ip: string) {
    const tenantId = requireContext(this.cls, 'tenantId');
    const actorId = requireContext(this.cls, 'userId');
    await this.limiter.consume(`invite:tenant:${tenantId}`, { limit: 50, windowMs: 3600_000 });

    // Scoped lookup: a role id from another atelier is simply not found.
    const role = await this.tenantDb.db().role.findFirst({
      where: { id: input.roleId },
      select: { id: true, key: true, name: true },
    });
    if (!role) throw new NotFoundError('Role not found.');
    if (role.key === 'owner') {
      throw new DomainError('ROLE_NOT_ASSIGNABLE', 'Ownership is transferred, not invited.');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (user) {
      const member = await this.tenantDb
        .db()
        .tenantMembership.findFirst({ where: { userId: user.id } });
      if (member) {
        throw new DomainError(
          'ALREADY_MEMBER',
          'This person is already a member.',
          HttpStatus.CONFLICT,
        );
      }
    }

    // A new invitation replaces earlier unused ones for the same email.
    await this.prisma.authToken.updateMany({
      where: { purpose: 'INVITE', tenantId, email: input.email, usedAt: null },
      data: { usedAt: new Date() },
    });
    const { token, expiresAt } = await this.tokens.issue({
      purpose: 'INVITE',
      tenantId,
      email: input.email,
      metadata: { roleId: role.id, invitedBy: actorId },
    });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true },
    });
    await this.mailer.send(
      emails.invitation(
        input.email,
        tenant.name,
        role.name,
        `${this.env.APP_PUBLIC_URL}/accept-invitation?token=${token}`,
      ),
    );
    await this.audit.tenant({
      actorType: 'USER',
      actorId,
      action: 'membership.invited',
      targetType: 'role',
      targetId: role.id,
      ip,
      metadata: { email: input.email },
    });
    return { email: input.email, roleId: role.id, expiresAt: expiresAt.toISOString() };
  }
}
