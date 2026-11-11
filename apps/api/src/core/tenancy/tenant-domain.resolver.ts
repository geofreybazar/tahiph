import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseClient } from '@tahi/database';
import { UNSCOPED_PRISMA } from '../database/tokens.js';

/** Tenant statuses whose storefront is online (docs/MULTI_TENANCY.md §9). */
const ONLINE = new Set(['TRIAL', 'ACTIVE', 'PAST_DUE']);

/**
 * Host → tenant for storefront hosts. Only verified domains of online tenants resolve.
 * Not cached yet (ADR-019): one indexed lookup per request.
 */
@Injectable()
export class TenantDomainResolver {
  constructor(@Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient) {}

  async resolve(hostname: string): Promise<{ tenantId: string } | null> {
    const domain = await this.prisma.tenantDomain.findUnique({
      where: { hostname },
      select: { tenantId: true, verifiedAt: true, tenant: { select: { status: true } } },
    });
    if (!domain?.verifiedAt || !ONLINE.has(domain.tenant.status)) return null;
    return { tenantId: domain.tenantId };
  }
}
