import { Global, Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { TenantDomainResolver } from '../tenancy/tenant-domain.resolver.js';
import { AccessGuard } from './access.guard.js';
import { RouteAccessAudit } from './route-audit.js';
import { SessionService } from './session.service.js';

/** Global access control for the HTTP entrypoint (deny by default). */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    SessionService,
    TenantDomainResolver,
    RouteAccessAudit,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [SessionService, TenantDomainResolver],
})
export class AuthCoreModule {}
