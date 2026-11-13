import { Inject, Injectable } from '@nestjs/common';
import type { TenantDatabase } from '@tahi/database';
import { TENANT_DB } from '../database/tenant-database.provider.js';

export type CounterKey = 'QUO' | 'ORD' | 'RCPT';

/** The calendar year at `now` in an IANA time zone (numbers restart each local year). */
export const yearIn = (timezone: string, now = new Date()) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric' }).format(now));

/**
 * Human numbers like QUO-2026-0007 (DATABASE_DESIGN.md §1). One atomic upsert-increment: the
 * conflicting row stays locked until the caller's transaction ends, so concurrent callers get
 * distinct, gap-free values. Call inside withTenantTx so a rollback releases the number.
 */
@Injectable()
export class CounterService {
  constructor(@Inject(TENANT_DB) private readonly tenantDb: TenantDatabase) {}

  async next(key: CounterKey, year: number): Promise<string> {
    const [row] = await this.tenantDb.db().$queryRaw<{ value: number }[]>`
      INSERT INTO tenant_counter (tenant_id, key, year, value)
      VALUES (app_tenant_id(), ${key}, ${year}, 1)
      ON CONFLICT (tenant_id, key, year) DO UPDATE SET value = tenant_counter.value + 1
      RETURNING value`;
    return `${key}-${year}-${String(row!.value).padStart(4, '0')}`;
  }
}
