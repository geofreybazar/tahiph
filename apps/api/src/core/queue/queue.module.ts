import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { QUEUES } from './queues.js';

/** BullMQ connection + queue registration, shared by the API (producers) and worker (consumers). */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ENV],
      useFactory: (env: Env) => {
        const url = new URL(env.REDIS_URL);
        return {
          prefix: 'tahi',
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
            ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
            db: Number(url.pathname.slice(1) || 0),
            ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
            maxRetriesPerRequest: null, // required by BullMQ workers
          },
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: { age: 24 * 3600, count: 1000 },
            removeOnFail: { age: 7 * 24 * 3600 },
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: QUEUES.maintenance },
      { name: QUEUES.email },
      { name: QUEUES.reminders },
      { name: QUEUES.media },
      { name: QUEUES.quotations },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
