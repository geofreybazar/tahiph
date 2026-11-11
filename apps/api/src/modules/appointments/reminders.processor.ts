import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { QUEUES } from '../../core/queue/queues.js';
import { TenantJobRunner } from '../../core/tenancy/tenant-job-runner.js';
import { RemindersService } from './reminders.service.js';

export const SWEEP_JOB = 'sweep';
export const TENANT_JOB = 'tenant';
const SWEEP_EVERY_MS = 10 * 60_000;

/**
 * Every 10 minutes the sweep fans out one job per operational tenant; each tenant job sends
 * that tenant's due reminders inside its own tenant context (ADR-029).
 */
@Processor(QUEUES.reminders, { concurrency: 5 })
export class RemindersProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(RemindersProcessor.name);

  constructor(
    @InjectQueue(QUEUES.reminders) private readonly queue: Queue,
    private readonly runner: TenantJobRunner,
    private readonly reminders: RemindersService,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    // Idempotent across restarts.
    await this.queue.upsertJobScheduler(SWEEP_JOB, { every: SWEEP_EVERY_MS }, { name: SWEEP_JOB });
  }

  async process(job: Job<{ tenantId?: string }>): Promise<number | undefined> {
    switch (job.name) {
      case SWEEP_JOB:
        return this.sweep();
      case TENANT_JOB:
        return this.runner.run(job.data.tenantId!, () => this.reminders.sendDue());
      default:
        throw new Error(`Unknown reminders job: ${job.name}`);
    }
  }

  async sweep(): Promise<number> {
    const ids = await this.runner.operationalTenantIds();
    // One job per tenant and sweep window: a repeated sweep does not double the work.
    const window = Math.floor(Date.now() / SWEEP_EVERY_MS);
    await this.queue.addBulk(
      ids.map((tenantId) => ({
        name: TENANT_JOB,
        data: { tenantId },
        opts: { jobId: `reminders:${tenantId}:${window}`, removeOnComplete: true },
      })),
    );
    this.logger.debug({ tenants: ids.length }, 'reminder sweep');
    return ids.length;
  }
}
