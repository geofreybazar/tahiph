import { Inject, Injectable } from '@nestjs/common';
import type { TenantDatabase } from '@tahi/database';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { TenantSettingsService } from '../tenants/tenant-settings.service.js';
import { asDate, todayIn } from './quotations.service.js';

/** Worker side of quotations (ADR-033); kept apart so the worker needs only DB and settings. */
@Injectable()
export class QuotationExpiryService {
  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    private readonly settings: TenantSettingsService,
  ) {}

  /** SENT quotations whose last valid day has passed in the atelier's timezone. */
  async expireDue(): Promise<number> {
    const { timezone } = await this.settings.settings();
    const { count } = await this.tenantDb.db().quotation.updateMany({
      where: { status: 'SENT', validUntil: { lt: asDate(todayIn(timezone)) } },
      data: { status: 'EXPIRED', version: { increment: 1 } },
    });
    return count;
  }
}
