import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { DatabaseClient } from '@tahi/database';
import { SYSTEM_ROLES } from '@tahi/types';
import type { CreateAtelierRequest } from '@tahi/validation';
import { RateLimiter } from '../../core/auth/rate-limit.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { UNSCOPED_PRISMA } from '../../core/database/tokens.js';
import { DomainError } from '../../core/http/domain-error.js';
import { AuthService, type RequestMeta, type StartedSession } from '../auth/auth.service.js';

const DAY = 24 * 3600_000;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'P2002';
}

export interface AtelierCreated {
  atelier: { id: string; name: string; slug: string; status: string };
  membershipId: string;
  storefrontHost: string;
  session: StartedSession;
}

/**
 * Creates an atelier in one transaction (docs/AUTHENTICATION_AND_AUTHORIZATION.md §3.1):
 * tenant + verified subdomain + system roles + the creator's OWNER membership + audit entry.
 * Default settings, templates and workflows arrive with their modules (Phase 3+).
 */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient,
    @Inject(ENV) private readonly env: Env,
    private readonly limiter: RateLimiter,
    private readonly auth: AuthService,
  ) {}

  async createAtelier(
    userId: string,
    input: CreateAtelierRequest,
    meta: RequestMeta,
  ): Promise<AtelierCreated> {
    await this.limiter.consume(`onboard:user:${userId}`, { limit: 5, windowMs: DAY });
    const hostname = `${input.slug}.${this.env.STOREFRONT_ROOT_DOMAIN}`;

    let created: { tenant: AtelierCreated['atelier']; membershipId: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            slug: input.slug,
            name: input.businessName,
            status: this.env.TENANT_ONBOARDING_STATUS,
            domains: {
              create: { hostname, type: 'SUBDOMAIN', isPrimary: true, verifiedAt: new Date() },
            },
          },
          select: { id: true, name: true, slug: true, status: true },
        });
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        let ownerRoleId = '';
        for (const def of SYSTEM_ROLES) {
          const role = await tx.role.create({
            data: {
              tenantId: tenant.id,
              key: def.key,
              name: def.name,
              isSystem: true,
              permissions: { create: def.permissions.map((permission) => ({ permission })) },
            },
            select: { id: true },
          });
          if (def.key === 'owner') ownerRoleId = role.id;
        }
        const membership = await tx.tenantMembership.create({
          data: { tenantId: tenant.id, userId, roleId: ownerRoleId, status: 'ACTIVE' },
          select: { id: true },
        });
        await tx.tenantAuditLog.create({
          data: {
            tenantId: tenant.id,
            actorType: 'USER',
            actorId: userId,
            action: 'tenant.created',
            targetType: 'tenant',
            targetId: tenant.id,
            ip: meta.ip,
            metadata: { slug: tenant.slug, status: tenant.status },
          },
        });
        return { tenant, membershipId: membership.id };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(
          'SLUG_TAKEN',
          'This web address is already taken.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }

    // Switch straight into the new atelier when it is usable (TRIAL); otherwise it awaits approval.
    const session =
      created.tenant.status === 'TRIAL'
        ? await this.auth.startSession(userId, meta, created.membershipId)
        : await this.auth.startSession(userId, meta);
    return {
      atelier: created.tenant,
      membershipId: created.membershipId,
      storefrontHost: hostname,
      session,
    };
  }
}
