import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ActorType, DatabaseClient, Prisma, TenantDatabase } from '@tahi/database';
import { TENANT_DB } from '../database/tenant-database.provider.js';
import { UNSCOPED_PRISMA } from '../database/tokens.js';

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Append-only audit trail (docs/AUTHENTICATION_AND_AUTHORIZATION.md §9). Never store
 * passwords, tokens or other secrets in metadata.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient,
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
  ) {}

  /** Platform/identity events (login, password reset…). */
  async platform(entry: AuditEntry & { tenantId?: string }): Promise<void> {
    await this.prisma.auditLog.create({
      data: this.row(entry, { tenantId: entry.tenantId ?? null }),
    });
  }

  /** Events of the current tenant (requires tenant context; joins an open withTenantTx). */
  async tenant(entry: AuditEntry): Promise<void> {
    await this.tenantDb.db().tenantAuditLog.create({ data: this.row(entry, {}) as never });
  }

  /** Audit must not break the user's action; failures are logged loudly instead. */
  async platformSafe(entry: AuditEntry & { tenantId?: string }): Promise<void> {
    await this.platform(entry).catch((err: unknown) => {
      this.logger.error({ err, action: entry.action }, 'audit write failed');
    });
  }

  private row(entry: AuditEntry, extra: Record<string, unknown>) {
    return {
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ip: entry.ip ?? null,
      ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
      ...extra,
    };
  }
}
