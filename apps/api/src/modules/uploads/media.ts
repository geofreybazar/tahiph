import type { MediaAsset as MediaAssetRow } from '@tahi/database';
import type { MediaAsset } from '@tahi/validation';
import type { StorageService } from '../../core/storage/storage.service.js';

/**
 * Object keys derive from tenant + asset id, so the table stores none. Kept images live under
 * t/{tenantId}/ (SECURITY.md); raw uploads under pending/ so one lifecycle rule can expire them.
 */
export const mediaKeys = (tenantId: string, id: string) => ({
  /** Raw browser upload. A bucket lifecycle rule expires `pending/` after 1 day (ADR-031). */
  pending: `pending/${tenantId}/${id}`,
  display: `t/${tenantId}/media/${id}/display.webp`,
  thumb: `t/${tenantId}/media/${id}/thumb.webp`,
});

export const UPLOAD_URL_TTL_SECONDS = 5 * 60;
export const VIEW_URL_TTL_SECONDS = 15 * 60;

export async function toAsset(row: MediaAssetRow, storage: StorageService): Promise<MediaAsset> {
  const keys = mediaKeys(row.tenantId, row.id);
  return {
    id: row.id,
    purpose: row.purpose,
    status: row.status,
    contentType: row.contentType,
    width: row.width,
    height: row.height,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt.toISOString(),
    urls:
      row.status === 'READY'
        ? {
            display: await storage.presignGet(keys.display, VIEW_URL_TTL_SECONDS),
            thumb: await storage.presignGet(keys.thumb, VIEW_URL_TTL_SECONDS),
          }
        : null,
  };
}
