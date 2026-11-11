import {
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { DatabaseClient, SessionRealm, TenantDatabase } from '@tahi/database';
import { PLATFORM_ROLE_PERMISSIONS, isTenantPermission, type Permission } from '@tahi/types';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { RequestContext, RouteRealm } from '../context/request-context.js';
import { TENANT_DB } from '../database/tenant-database.provider.js';
import { UNSCOPED_PRISMA } from '../database/tokens.js';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '../http/domain-error.js';
import { classifyHost, normalizeHost, realmServedOn } from '../tenancy/host.js';
import { TenantDomainResolver } from '../tenancy/tenant-domain.resolver.js';
import { SESSION_COOKIES, readCookie } from './cookies.js';
import { assertCsrf } from './csrf.js';
import { readRouteAccess, type RouteAccess } from './route-access.js';
import { SessionService, type ActiveSession } from './session.service.js';

const SESSION_REALM: Record<'tenant' | 'platform' | 'customer', SessionRealm> = {
  tenant: 'TENANT',
  platform: 'PLATFORM',
  customer: 'CUSTOMER',
};

/** Tenant statuses with full dashboard access (docs/MULTI_TENANCY.md §9). */
const OPERATIONAL_TENANT = new Set(['TRIAL', 'ACTIVE', 'PAST_DUE']);

/**
 * The single global guard (docs/AUTHENTICATION_AND_AUTHORIZATION.md §7.3):
 * 1. deny routes without access configuration;
 * 2. the route's realm must match the Host (otherwise 404: the route does not exist there);
 * 3. storefront hosts resolve the tenant from TenantDomain;
 * 4. load and validate the realm's session, subject, membership and tenant;
 * 5. check permissions.
 * Tenant context is only ever set here, from server-side data.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<RequestContext>,
    private readonly sessions: SessionService,
    private readonly domains: TenantDomainResolver,
    @Inject(ENV) private readonly env: Env,
    @Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient,
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return false;
    const access = readRouteAccess(this.reflector, context.getHandler(), context.getClass());
    if (!access) {
      this.logger.error(
        `Route ${context.getClass().name}.${context.getHandler().name} has no access configuration`,
      );
      throw new ForbiddenError();
    }
    if (access.realm === 'internal') return true;

    const req = context.switchToHttp().getRequest<Request>();
    const host = normalizeHost(req.headers.host);
    if (!host || !realmServedOn(access.realm, classifyHost(host, this.env)))
      throw new NotFoundError();
    this.cls.set('realm', access.realm);
    this.cls.set('host', host);
    // Every state-changing request on a browser host, public or not (login CSRF included).
    assertCsrf(req, host, this.env.NODE_ENV === 'production');

    if (access.realm === 'public' || access.realm === 'customer') {
      const tenant = await this.domains.resolve(host);
      if (!tenant) throw new NotFoundError();
      this.cls.set('tenantId', tenant.tenantId);
    }
    if (access.mode === 'public') return true;

    const realm = access.realm as 'tenant' | 'platform' | 'customer';
    const sessionRealm = SESSION_REALM[realm];
    const session = await this.sessions.resolve(
      sessionRealm,
      readCookie(req.headers.cookie, SESSION_COOKIES[sessionRealm]),
    );
    if (!session) throw new UnauthenticatedError();
    this.cls.set('sessionId', session.id);

    const permissions =
      realm === 'tenant'
        ? await this.authenticateStaff(session)
        : realm === 'platform'
          ? await this.authenticatePlatform(session, access)
          : this.authenticateCustomer(session);

    await this.sessions.touch(session);
    this.authorize(access, permissions);
    return true;
  }

  private async authenticateStaff(session: ActiveSession): Promise<ReadonlySet<Permission> | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: session.subjectId },
      select: { id: true, status: true },
    });
    if (user?.status !== 'ACTIVE') throw new UnauthenticatedError();
    this.cls.set('userId', user.id);

    if (!session.tenantId || !session.activeMembershipId) return null;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { status: true },
    });
    if (!tenant || !OPERATIONAL_TENANT.has(tenant.status)) return null;

    // Read the membership under the session's tenant, through RLS.
    this.cls.set('tenantId', session.tenantId);
    const membership = await this.tenantDb.db().tenantMembership.findUnique({
      where: { id: session.activeMembershipId },
      select: {
        id: true,
        userId: true,
        status: true,
        role: { select: { permissions: { select: { permission: true } } } },
      },
    });
    if (membership?.userId !== user.id || membership.status !== 'ACTIVE') {
      this.cls.set('tenantId', undefined);
      return null;
    }
    this.cls.set('membershipId', membership.id);
    const perms = new Set<Permission>(
      membership.role.permissions.map((p) => p.permission).filter(isTenantPermission),
    );
    this.cls.set('permissions', perms);
    return perms;
  }

  private async authenticatePlatform(
    session: ActiveSession,
    access: RouteAccess,
  ): Promise<ReadonlySet<Permission>> {
    const admin = await this.prisma.platformUser.findUnique({
      where: { id: session.subjectId },
      select: { id: true, status: true, role: true },
    });
    if (admin?.status !== 'ACTIVE') throw new UnauthenticatedError();
    if (!session.mfaVerifiedAt && !access.allowMfaPending) {
      throw new UnauthenticatedError('Multi-factor authentication is required.');
    }
    this.cls.set('platformUserId', admin.id);
    const perms = new Set<Permission>(
      session.mfaVerifiedAt ? PLATFORM_ROLE_PERMISSIONS[admin.role] : [],
    );
    this.cls.set('permissions', perms);
    return perms;
  }

  private authenticateCustomer(session: ActiveSession): ReadonlySet<Permission> {
    // A customer session is bound to one tenant; it is never valid on another tenant's host.
    // CustomerAccount status checks arrive with the customer-auth work.
    if (!session.tenantId || session.tenantId !== this.cls.get('tenantId')) {
      throw new UnauthenticatedError();
    }
    this.cls.set('customerSessionTenantId', session.tenantId);
    return new Set();
  }

  private authorize(access: RouteAccess, permissions: ReadonlySet<Permission> | null): void {
    if (access.mode !== 'permission') return;
    if (!permissions) {
      throw new ForbiddenError('NO_ACTIVE_TENANT', 'Select an active atelier to continue.');
    }
    if (!access.permissions.every((p) => permissions.has(p))) throw new ForbiddenError();
  }
}

export type { RouteRealm };
