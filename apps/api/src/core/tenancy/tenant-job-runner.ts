import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DatabaseClient } from '@tahi/database';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../context/request-context.js';
import { UNSCOPED_PRISMA } from '../database/tokens.js';
import { OPERATIONAL_TENANT_STATUSES } from './operational.js';

/**
 * Runs background work inside one tenant (docs/MULTI_TENANCY.md §8): a fresh CLS context with
 * the tenant id, so TENANT_DB and RLS apply exactly as in a request. The tenant is re-checked
 * at run time; work for a missing or non-operational tenant is skipped, not failed.
 */
@Injectable()
export class TenantJobRunner {
  private readonly logger = new Logger(TenantJobRunner.name);

  constructor(
    private readonly cls: ClsService<RequestContext>,
    @Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient,
  ) {}

  /** Ids of tenants that may run background work now. */
  async operationalTenantIds(): Promise<string[]> {
    const rows = await this.prisma.tenant.findMany({
      where: { status: { in: [...OPERATIONAL_TENANT_STATUSES] as never } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async run<T>(tenantId: string, fn: () => Promise<T>): Promise<T | undefined> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    if (!tenant || !OPERATIONAL_TENANT_STATUSES.has(tenant.status)) {
      this.logger.warn({ tenantId }, 'skipping job for a missing or non-operational tenant');
      return undefined;
    }
    return this.cls.run(async () => {
      this.cls.set('tenantId', tenantId);
      this.cls.set('realm', 'tenant');
      return fn();
    });
  }
}
