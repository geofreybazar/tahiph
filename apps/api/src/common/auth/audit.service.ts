import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '../../generated/prisma/client';
import { BASE_PRISMA } from '../prisma/base-prisma.token';
import { RequestContext } from '../request-context/request-context';

export interface AuditEntry {
  action: string;
  tenantId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonObject;
}

/** Audit rows span tenants, so they're written here rather than through the scoped client. */
@Injectable()
export class AuditService {
  constructor(
    @Inject(BASE_PRISMA) private readonly prisma: PrismaClient,
    private readonly context: RequestContext,
  ) {}

  async record({ tenantId, ...entry }: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        ...entry,
        tenantId: tenantId ?? this.context.tenantId ?? null,
        actorUserId: this.context.principal?.userId ?? null,
      },
    });
  }
}
