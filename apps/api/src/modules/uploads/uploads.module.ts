import { Module } from '@nestjs/common';
import { AuditModule } from '../../core/audit/audit.module.js';
import { QueueModule } from '../../core/queue/queue.module.js';
import { StorageModule } from '../../core/storage/storage.module.js';
import { TenantJobRunner } from '../../core/tenancy/tenant-job-runner.js';
import { MediaProcessingService } from './media-processing.service.js';
import { MediaProcessor } from './media.processor.js';
import { CatalogImagesController, LogoController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';

/** HTTP side of uploads: presign, confirm, list, delete (ADR-031). */
@Module({
  imports: [QueueModule, StorageModule, AuditModule],
  controllers: [CatalogImagesController, LogoController],
  providers: [UploadsService],
})
export class UploadsModule {}

/** Worker side: verifies and re-encodes confirmed uploads. No controllers. */
@Module({
  imports: [QueueModule, StorageModule],
  providers: [TenantJobRunner, MediaProcessingService, MediaProcessor],
})
export class UploadsWorkerModule {}
