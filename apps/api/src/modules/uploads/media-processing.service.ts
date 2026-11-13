import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TenantDatabase } from '@tahi/database';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { renderImage } from './image.js';
import { mediaKeys } from './media.js';

/**
 * Worker step of an upload (runs inside TenantJobRunner): verify the bytes, write WebP
 * renditions, delete the original. Storage errors throw so BullMQ retries; bad files are
 * rejected, not retried.
 */
@Injectable()
export class MediaProcessingService {
  private readonly logger = new Logger(MediaProcessingService.name);

  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    private readonly storage: StorageService,
  ) {}

  async process(assetId: string): Promise<'READY' | 'REJECTED' | 'SKIPPED'> {
    const db = () => this.tenantDb.db();
    const asset = await db().mediaAsset.findFirst({ where: { id: assetId, status: 'PROCESSING' } });
    if (!asset) return 'SKIPPED'; // deleted, or already done by an earlier attempt
    const keys = mediaKeys(asset.tenantId, asset.id);
    const finish = (data: object) =>
      db().mediaAsset.updateMany({ where: { id: asset.id, status: 'PROCESSING' }, data });

    const bytes = await this.storage.get(keys.pending);
    const result = bytes
      ? await renderImage(bytes, asset.contentType)
      : ({ ok: false, reason: 'file is missing' } as const);
    if (!result.ok) {
      await finish({ status: 'REJECTED', rejectReason: result.reason });
      await this.storage.delete(keys.pending);
      return 'REJECTED';
    }

    await this.storage.put(keys.display, result.display.data, 'image/webp');
    await this.storage.put(keys.thumb, result.thumb.data, 'image/webp');
    const { count } = await finish({
      status: 'READY',
      width: result.display.width,
      height: result.display.height,
    });
    await this.storage.delete(keys.pending);
    if (count === 0) {
      // Deleted by a user while we worked: don't leave the renditions behind.
      await this.storage.delete(keys.display, keys.thumb);
      return 'SKIPPED';
    }
    if (asset.purpose === 'LOGO') await this.removeOlderLogos(asset.id, asset.createdAt);
    return 'READY';
  }

  /** One logo per atelier: a newly ready logo replaces every older one. */
  private async removeOlderLogos(keepId: string, createdAt: Date) {
    const older = await this.tenantDb.db().mediaAsset.findMany({
      where: { purpose: 'LOGO', id: { not: keepId }, createdAt: { lte: createdAt } },
      select: { id: true, tenantId: true },
    });
    if (older.length === 0) return;
    await this.tenantDb
      .db()
      .mediaAsset.deleteMany({ where: { id: { in: older.map((o) => o.id) } } });
    for (const o of older) {
      const k = mediaKeys(o.tenantId, o.id);
      await this.storage.delete(k.pending, k.display, k.thumb);
    }
    this.logger.debug({ removed: older.length }, 'replaced logo');
  }
}
