import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { QUEUES } from '../../core/queue/queues.js';
import { TenantJobRunner } from '../../core/tenancy/tenant-job-runner.js';
import { QuotationExpiryService } from './quotation-expiry.service.js';

export const EXPIRY_SWEEP_JOB = 'expiry-sweep';
export const TENANT_EXPIRY_JOB = 'tenant-expiry';
const SWEEP_EVERY_MS = 60 * 60_000;

/**
 * Hourly, one job per operational tenant expires its SENT quotations whose date has passed
 * in the atelier's timezone (ADR-033; same fan-out as reminders, ADR-029).
 */
@Processor(QUEUES.quotations, { concurrency: 5 })
export class QuotationsProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(QuotationsProcessor.name);

  constructor(
    @InjectQueue(QUEUES.quotations) private readonly queue: Queue,
    private readonly runner: TenantJobRunner,
    private readonly expiry: QuotationExpiryService,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      EXPIRY_SWEEP_JOB,
      { every: SWEEP_EVERY_MS },
      { name: EXPIRY_SWEEP_JOB },
    );
  }

  async process(job: Job<{ tenantId?: string }>): Promise<number | undefined> {
    switch (job.name) {
      case EXPIRY_SWEEP_JOB: {
        const ids = await this.runner.operationalTenantIds();
        const window = Math.floor(Date.now() / SWEEP_EVERY_MS);
        await this.queue.addBulk(
          ids.map((tenantId) => ({
            name: TENANT_EXPIRY_JOB,
            data: { tenantId },
            opts: { jobId: `quotation-expiry:${tenantId}:${window}`, removeOnComplete: true },
          })),
        );
        this.logger.debug({ tenants: ids.length }, 'quotation expiry sweep');
        return ids.length;
      }
      case TENANT_EXPIRY_JOB:
        return this.runner.run(job.data.tenantId!, () => this.expiry.expireDue());
      default:
        throw new Error(`Unknown quotations job: ${job.name}`);
    }
  }
}
