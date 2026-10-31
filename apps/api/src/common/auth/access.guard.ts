import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { z } from 'zod';
import { ApiException } from '../http/api-exception';
import { Principal, RequestContext } from '../request-context/request-context';
import { RouteAccess, ROUTE_ACCESS } from './decorators';
import { IdentityRepository } from './identity.repository';
import { can } from './permissions';

const denied = () =>
  new ApiException(403, 'TENANT_ACCESS_DENIED', 'You do not have access to this business');

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identity: IdentityRepository,
    private readonly context: RequestContext,
  ) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const access = this.reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, [
      execution.getHandler(),
      execution.getClass(),
    ]);
    const principal = this.context.principal;
    if (!access || access.kind === 'public' || !principal) return true;

    if (access.kind === 'platform') {
      await this.checkPlatform(principal);
      return true;
    }

    const header = execution.switchToHttp().getRequest<Request>().headers['x-tenant-id'];
    if (!header) {
      throw new ApiException(400, 'TENANT_REQUIRED', 'Choose a business to continue');
    }
    // The same answer as a real tenant the user can't access, so existence isn't revealed.
    const tenantId = z.uuid().safeParse(header);
    if (!tenantId.success) throw denied();

    const membership = await this.identity.findActiveMembership(principal.userId, tenantId.data);
    if (!membership) throw denied();
    if (membership.tenant.status !== 'active') {
      throw new ApiException(403, 'TENANT_SUSPENDED', 'This business is currently unavailable');
    }
    if (access.permission && !can(membership.role, access.permission)) {
      throw new ApiException(403, 'FORBIDDEN', 'Your role does not allow this');
    }

    this.context.setTenant(tenantId.data, membership.role);
    return true;
  }

  private async checkPlatform({ userId, aal }: Principal): Promise<void> {
    if (!(await this.identity.isPlatformAdmin(userId))) {
      throw new ApiException(403, 'FORBIDDEN', 'Your role does not allow this');
    }
    if (aal !== 'aal2') {
      throw new ApiException(403, 'MFA_REQUIRED', 'Complete two-factor sign-in to continue');
    }
  }
}
