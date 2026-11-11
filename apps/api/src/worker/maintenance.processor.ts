import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { REDIS } from '../core/redis/redis.module.js';
import {
  QUEUES,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
} from '../core/queue/queues.js';

export const HEARTBEAT_JOB = 'heartbeat';
const HEARTBEAT_EVERY_MS = 60_000;

/**
 * Platform-level maintenance jobs. Phase 1 runs only the heartbeat, which proves the worker
 * is consuming jobs and backs the worker container health check.
 */
@Processor(QUEUES.maintenance)
export class MaintenanceProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    @InjectQueue(QUEUES.maintenance) private readonly queue: Queue,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    // Idempotent: upserting a job scheduler never creates duplicates across restarts.
    await this.queue.upsertJobScheduler(
      HEARTBEAT_JOB,
      { every: HEARTBEAT_EVERY_MS },
      { name: HEARTBEAT_JOB },
    );
    await this.beat();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case HEARTBEAT_JOB:
        await this.beat();
        return;
      default:
        throw new Error(`Unknown maintenance job: ${job.name}`);
    }
  }

  private async beat(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
    await this.redis.set(
      WORKER_HEARTBEAT_KEY,
      new Date().toISOString(),
      'EX',
      WORKER_HEARTBEAT_TTL_SECONDS,
    );
    this.logger.debug('heartbeat');
  }
}
