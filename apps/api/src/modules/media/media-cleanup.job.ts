import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BASE_PRISMA } from '../../common/prisma/base-prisma.token';
import { ScopedPrisma } from '../../common/prisma/prisma-clients';
import { SCOPED_PRISMA } from '../../common/prisma/scoped-prisma.token';
import { RequestContext } from '../../common/request-context/request-context';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class MediaCleanupJob {
  private readonly logger = new Logger(MediaCleanupJob.name);

  constructor(
    @Inject(BASE_PRISMA) private readonly base: PrismaClient,
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrisma,
    private readonly context: RequestContext,
    private readonly storage: StorageService,
  ) {}

  // shortcut: no lock, safe on one API instance. Add a database lock before running two.
  @Cron(CronExpression.EVERY_HOUR)
  async removeAbandonedUploads(now = new Date()): Promise<number> {
    const tenants = await this.base.mediaFile.findMany({
      where: { status: 'pending', expiresAt: { lt: now } },
      distinct: ['tenantId'],
      select: { tenantId: true },
    });

    let removed = 0;
    for (const { tenantId } of tenants) {
      // One tenant's failure mustn't stop the others; the next run retries it.
      try {
        removed += await this.context.runInTenant(tenantId, () => this.cleanTenant(now));
      } catch (error) {
        this.logger.error(`Cleanup failed for tenant ${tenantId}: ${String(error)}`);
      }
    }
    return removed;
  }

  private async cleanTenant(now: Date): Promise<number> {
    const files = await this.db.mediaFile.findMany({
      where: { status: 'pending', expiresAt: { lt: now } },
    });
    if (files.length === 0) return 0;

    // Storage first: if this fails the rows remain, so the objects aren't orphaned for good.
    await this.storage.remove(
      'private-media',
      files.map((file) => file.objectKey),
    );
    await this.db.mediaFile.deleteMany({ where: { id: { in: files.map((file) => file.id) } } });
    return files.length;
  }
}
