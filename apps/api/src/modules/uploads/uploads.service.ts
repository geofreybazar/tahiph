import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { TenantDatabase } from '@tahi/database';
import { MAX_IMAGE_BYTES, type CreateUploadRequest } from '@tahi/validation';
import type { Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../core/audit/audit.service.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { DomainError, NotFoundError } from '../../core/http/domain-error.js';
import { QUEUES } from '../../core/queue/queues.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { mediaKeys, toAsset, UPLOAD_URL_TTL_SECONDS } from './media.js';

/** Which owner an upload belongs to. Each controller fixes its own scope. */
export type MediaScope =
  { purpose: 'LOGO' } | { purpose: 'CATALOG_ITEM_IMAGE'; catalogItemId: string };

export interface MediaJob {
  tenantId: string;
  assetId: string;
}

class UploadNotReceivedError extends DomainError {
  constructor() {
    super('UPLOAD_NOT_RECEIVED', 'The file has not been uploaded yet.', HttpStatus.CONFLICT);
  }
}

/**
 * Upload flow (ADR-031): create → the browser PUTs to the signed URL → confirm checks the stored
 * object and queues the worker, which verifies and re-encodes it. Storage calls never run inside
 * a tenant transaction.
 */
@Injectable()
export class UploadsService {
  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUES.media) private readonly queue: Queue<MediaJob>,
  ) {}

  private where(scope: MediaScope, id?: string) {
    return {
      ...(id ? { id } : {}),
      purpose: scope.purpose,
      ...(scope.purpose === 'CATALOG_ITEM_IMAGE' ? { catalogItemId: scope.catalogItemId } : {}),
    };
  }

  private async find(scope: MediaScope, id: string) {
    // Scoped: another atelier's (or another owner's) asset is not found (404).
    const row = await this.tenantDb.db().mediaAsset.findFirst({ where: this.where(scope, id) });
    if (!row) throw new NotFoundError('Image not found.');
    return row;
  }

  private async assertOwnerExists(scope: MediaScope) {
    if (scope.purpose !== 'CATALOG_ITEM_IMAGE') return;
    const item = await this.tenantDb.db().catalogItem.findFirst({
      where: { id: scope.catalogItemId },
      select: { id: true },
    });
    if (!item) throw new NotFoundError('Catalogue item not found.');
  }

  async create(scope: MediaScope, body: CreateUploadRequest, ip: string) {
    await this.assertOwnerExists(scope);
    const tenantId = requireContext(this.cls, 'tenantId');
    const row = await this.tenantDb.db().mediaAsset.create({
      data: {
        tenantId,
        ...this.where(scope),
        contentType: body.contentType,
        createdByMembershipId: requireContext(this.cls, 'membershipId'),
      },
    });
    await this.audit.tenant({
      actorType: 'USER',
      actorId: requireContext(this.cls, 'userId'),
      action: 'media.upload_started',
      targetType: 'media_asset',
      targetId: row.id,
      ip,
    });
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000);
    const url = await this.storage.presignPut(
      mediaKeys(tenantId, row.id).pending,
      body.contentType,
      body.size,
      UPLOAD_URL_TTL_SECONDS,
    );
    return {
      asset: await toAsset(row, this.storage),
      upload: {
        method: 'PUT' as const,
        url,
        headers: { 'Content-Type': body.contentType },
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  /** Idempotent: a confirmed asset is returned as is (and its job re-queued if still processing). */
  async confirm(scope: MediaScope, id: string) {
    let row = await this.find(scope, id);
    if (row.status === 'PENDING') {
      const key = mediaKeys(row.tenantId, row.id).pending;
      const head = await this.storage.head(key);
      if (!head) throw new UploadNotReceivedError();
      // R2 doesn't enforce the signed length, so the real size is checked here.
      const reason =
        head.size > MAX_IMAGE_BYTES
          ? 'file is larger than 10 MB'
          : head.contentType !== row.contentType
            ? 'file type does not match the upload'
            : null;
      if (reason) await this.storage.delete(key);
      await this.tenantDb.db().mediaAsset.updateMany({
        where: { id, status: 'PENDING' },
        data: reason ? { status: 'REJECTED', rejectReason: reason } : { status: 'PROCESSING' },
      });
      row = await this.find(scope, id);
    }
    if (row.status === 'PROCESSING') {
      await this.queue.add(
        'process',
        { tenantId: row.tenantId, assetId: row.id },
        { jobId: `media-${row.id}` },
      );
    }
    return toAsset(row, this.storage);
  }

  /** Confirmed images of the owner, oldest first (unconfirmed uploads are not listed). */
  async list(scope: MediaScope) {
    await this.assertOwnerExists(scope);
    const rows = await this.tenantDb.db().mediaAsset.findMany({
      where: { ...this.where(scope), status: { not: 'PENDING' } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return Promise.all(rows.map((r) => toAsset(r, this.storage)));
  }

  /** The newest ready logo, or null. Older logos are removed by the worker. */
  async currentLogo() {
    const row = await this.tenantDb.db().mediaAsset.findFirst({
      where: { purpose: 'LOGO', status: 'READY' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row ? toAsset(row, this.storage) : null;
  }

  async remove(scope: MediaScope, id: string, ip: string): Promise<null> {
    const row = await this.find(scope, id);
    await this.tenantDb.db().mediaAsset.delete({ where: { id: row.id } });
    await this.audit.tenant({
      actorType: 'USER',
      actorId: requireContext(this.cls, 'userId'),
      action: 'media.deleted',
      targetType: 'media_asset',
      targetId: row.id,
      ip,
    });
    const k = mediaKeys(row.tenantId, row.id);
    // shortcut: a failed object delete leaves an orphan in the bucket; add a sweep if that shows up.
    await this.storage.delete(k.pending, k.display, k.thumb).catch(() => undefined);
    return null;
  }
}
