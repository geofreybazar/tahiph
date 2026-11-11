import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisRateLimitStore } from '../src/core/auth/rate-limit.js';
import { CoreModule } from '../src/core/core.module.js';
import { EmailWorkerModule, MailerModule } from '../src/core/email/email.module.js';
import {
  EMAIL_TRANSPORT,
  MAILER,
  type EmailMessage,
  type Mailer,
} from '../src/core/email/email.types.js';
import { QueueModule } from '../src/core/queue/queue.module.js';

/** Redis-backed pieces of auth: the rate-limit store and email delivery via BullMQ. */
describe('Redis services (integration: real Redis)', () => {
  let redis: Redis;

  beforeAll(() => {
    if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required');
    redis = new Redis(process.env.REDIS_URL);
  });

  afterAll(async () => {
    await redis?.quit();
  });

  it('RedisRateLimitStore counts within one window and expires', async () => {
    const store = new RedisRateLimitStore(redis);
    const key = `tahi:test:${randomUUID()}`;
    expect((await store.incr(key, 500)).count).toBe(1);
    const second = await store.incr(key, 60_000);
    expect(second.count).toBe(2);
    expect(second.ttlMs).toBeLessThanOrEqual(500); // the window is not extended by later hits
    await new Promise((r) => setTimeout(r, 600));
    expect((await store.incr(key, 500)).count).toBe(1);
    await store.set(`${key}:lock`, 1000);
    expect(await store.ttl(`${key}:lock`)).toBeGreaterThan(0);
    await store.del(key, `${key}:lock`);
    expect(await store.ttl(`${key}:lock`)).toBe(0);
  });

  it('delivers a queued email through the worker processor', async () => {
    const delivered: EmailMessage[] = [];
    @Module({ imports: [CoreModule, QueueModule, MailerModule, EmailWorkerModule] })
    class Both {}
    const ref = await Test.createTestingModule({ imports: [Both] })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({ deliver: (m: EmailMessage) => Promise.resolve(void delivered.push(m)) })
      .compile();
    const app = ref.createNestApplication({ logger: false });
    await app.init();
    try {
      const subject = `test ${randomUUID()}`;
      await app.get<Mailer>(MAILER).send({ to: 'q@example.test', subject, text: 't', html: 'h' });
      const deadline = Date.now() + 10_000;
      while (!delivered.some((m) => m.subject === subject) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(delivered.map((m) => m.subject)).toContain(subject);
    } finally {
      await app.close();
    }
  });
});
