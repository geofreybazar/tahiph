import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CreateUploadIntent, GARMENT_MEDIA_PURPOSES, MAX_MEDIA_BYTES } from '@tahi/shared';
import { can } from '../../common/auth/permissions';
import { ApiException } from '../../common/http/api-exception';
import type { ScopedPrisma } from '../../common/prisma/prisma-clients';
import { SCOPED_PRISMA } from '../../common/prisma/scoped-prisma.token';
import { RequestContext } from '../../common/request-context/request-context';
import { StorageService } from '../../common/storage/storage.service';
import { FILE_EXTENSIONS, sniffMimeType } from './media-types';

const BUCKET = 'private-media';
const DOWNLOAD_URL_SECONDS = 120;
// Signed upload URLs last 2 hours, so an abandoned row must outlive that.
const PENDING_HOURS = 24;

const notFound = () => new ApiException(404, 'NOT_FOUND', 'File not found');

@Injectable()
export class MediaService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrisma,
    private readonly storage: StorageService,
    private readonly context: RequestContext,
  ) {}

  /** Expense receipts follow the expense rules; staff can't see expenses. */
  private assertPurposeAllowed(purpose: string): void {
    if (purpose === 'expense_receipt' && !can(this.context.role!, 'expenses:manage')) {
      throw new ApiException(403, 'FORBIDDEN', 'Your role does not allow this');
    }
  }

  private assertUploaderOrManager(uploadedByUserId: string): void {
    const isUploader = uploadedByUserId === this.context.principal!.userId;
    if (!isUploader && !can(this.context.role!, 'members:manage')) {
      throw new ApiException(403, 'FORBIDDEN', 'Your role does not allow this');
    }
  }

  async createUploadIntent({ purpose, mimeType, sizeBytes, filename }: CreateUploadIntent) {
    this.assertPurposeAllowed(purpose);

    const id = randomUUID();
    const objectKey = `${this.context.tenantId}/${purpose}/${id}.${FILE_EXTENSIONS[mimeType]}`;
    const uploadUrl = await this.storage.createUploadUrl(BUCKET, objectKey);
    await this.db.mediaFile.create({
      data: {
        id,
        bucket: 'private_media',
        objectKey,
        purpose,
        mimeType,
        sizeBytes,
        originalFilename: filename ?? null,
        uploadedByUserId: this.context.principal!.userId,
        expiresAt: new Date(Date.now() + PENDING_HOURS * 60 * 60 * 1000),
      } as never,
    });
    return { id, uploadUrl };
  }

  async confirm(id: string) {
    const file = await this.db.mediaFile.findUnique({ where: { id } });
    if (!file) throw notFound();
    this.assertUploaderOrManager(file.uploadedByUserId);
    if (file.status === 'ready') return { id, status: file.status };

    const stored = await this.storage.inspect(BUCKET, file.objectKey);
    if (!stored) throw new ApiException(409, 'CONFLICT', 'The file has not been uploaded yet');

    const sniffed = sniffMimeType(stored.leadingBytes);
    if (sniffed !== file.mimeType || stored.sizeBytes > MAX_MEDIA_BYTES) {
      await this.storage.remove(BUCKET, [file.objectKey]);
      await this.db.mediaFile.delete({ where: { id } });
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        'The uploaded file is not the type that was declared, or is too large',
      );
    }

    const updated = await this.db.mediaFile.update({
      where: { id },
      data: { status: 'ready', sizeBytes: stored.sizeBytes, expiresAt: null },
    });
    return { id, status: updated.status };
  }

  async createDownloadUrl(id: string) {
    const file = await this.db.mediaFile.findUnique({ where: { id } });
    if (!file || file.status !== 'ready') throw notFound();
    this.assertPurposeAllowed(file.purpose);

    const url = await this.storage.createDownloadUrl(
      BUCKET,
      file.objectKey,
      DOWNLOAD_URL_SECONDS,
      file.originalFilename ?? undefined,
    );
    return { url, expiresInSeconds: DOWNLOAD_URL_SECONDS };
  }

  /** For garments: only a verified sketch or design reference can be attached. */
  async assertAttachableToGarment(id: string): Promise<void> {
    const file = await this.db.mediaFile.findUnique({ where: { id } });
    if (!file) throw notFound();
    if (file.status !== 'ready') {
      throw new ApiException(409, 'CONFLICT', 'The file has not been confirmed yet');
    }
    if (!(GARMENT_MEDIA_PURPOSES as readonly string[]).includes(file.purpose)) {
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        'This file cannot be attached to a garment',
      );
    }
  }

  async assertCanRemove(id: string): Promise<void> {
    const file = await this.db.mediaFile.findUnique({ where: { id } });
    if (!file) throw notFound();
    this.assertUploaderOrManager(file.uploadedByUserId);
  }

  async remove(id: string): Promise<void> {
    const file = await this.db.mediaFile.findUnique({ where: { id } });
    if (!file) throw notFound();
    this.assertUploaderOrManager(file.uploadedByUserId);

    // The row first: a foreign key refuses this while a record still uses the file.
    await this.db.mediaFile.delete({ where: { id } });
    await this.storage.remove(BUCKET, [file.objectKey]);
  }
}
