import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queue/queues.js';
import { EMAIL_TRANSPORT, type EmailMessage, type EmailTransport } from './email.types.js';

/** Worker: delivers queued emails. Retries with the queue's exponential backoff. */
@Processor(QUEUES.email, { concurrency: 5, limiter: { max: 10, duration: 1000 } })
export class EmailProcessor extends WorkerHost {
  constructor(@Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport) {
    super();
  }

  async process(job: Job<EmailMessage>): Promise<void> {
    await this.transport.deliver(job.data);
  }
}
