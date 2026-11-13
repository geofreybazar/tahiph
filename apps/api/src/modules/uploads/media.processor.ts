import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from '../../core/queue/queues.js';
import { TenantJobRunner } from '../../core/tenancy/tenant-job-runner.js';
import { MediaProcessingService } from './media-processing.service.js';
import type { MediaJob } from './uploads.service.js';

/** Image re-encoding is CPU-heavy, so concurrency stays low. */
@Processor(QUEUES.media, { concurrency: 2 })
export class MediaProcessor extends WorkerHost {
  constructor(
    private readonly runner: TenantJobRunner,
    private readonly media: MediaProcessingService,
  ) {
    super();
  }

  process(job: Job<MediaJob>) {
    return this.runner.run(job.data.tenantId, () => this.media.process(job.data.assetId));
  }
}
