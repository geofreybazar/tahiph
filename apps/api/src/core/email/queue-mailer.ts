import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from '../queue/queues.js';
import type { EmailMessage, Mailer } from './email.types.js';

/**
 * Enqueues emails for the worker. Jobs can contain one-time links, so completed jobs are
 * removed immediately and failed ones after a day (Redis is internal and password-protected).
 */
@Injectable()
export class QueueMailer implements Mailer {
  constructor(@InjectQueue(QUEUES.email) private readonly queue: Queue<EmailMessage>) {}

  async send(message: EmailMessage): Promise<void> {
    await this.queue.add('send', message, {
      removeOnComplete: true,
      removeOnFail: { age: 24 * 3600 },
    });
  }
}
