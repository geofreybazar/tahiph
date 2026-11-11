import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module.js';
import { WorkerModule } from './worker/worker.module.js';

/**
 * Dependency-injection wiring of both entrypoints. Integration tests replace some providers
 * (mailer, rate-limit store), so this compiles the real graphs. No connections are opened:
 * Prisma and ioredis connect lazily, and the module is closed before BullMQ needs Redis.
 */
describe('composition roots', () => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:1';

  it.each([
    ['AppModule', AppModule],
    ['WorkerModule', WorkerModule],
  ])('%s resolves every provider', async (_name, root) => {
    const ref = await Test.createTestingModule({ imports: [root] }).compile();
    expect(ref).toBeDefined();
    await ref.close();
  });
});
