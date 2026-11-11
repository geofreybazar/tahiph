import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WORKER_HEARTBEAT_KEY } from '../src/core/queue/queues.js';
import { WorkerModule } from '../src/worker/worker.module.js';

/** Integration: the worker boots without HTTP, connects to Redis and writes its heartbeat. */
describe('Worker (integration: real Redis)', () => {
  let worker: INestApplicationContext;
  let redis: Redis;

  beforeAll(async () => {
    if (!process.env.REDIS_URL || !process.env.DATABASE_URL) {
      throw new Error('Integration tests require DATABASE_URL and REDIS_URL');
    }
    redis = new Redis(process.env.REDIS_URL);
    await redis.del(WORKER_HEARTBEAT_KEY);
    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    await worker.init();
  });

  afterAll(async () => {
    await worker?.close();
    await redis?.quit();
  });

  it('writes the heartbeat key with a TTL on bootstrap', async () => {
    expect(await redis.get(WORKER_HEARTBEAT_KEY)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await redis.ttl(WORKER_HEARTBEAT_KEY)).toBeGreaterThan(0);
  });
});
