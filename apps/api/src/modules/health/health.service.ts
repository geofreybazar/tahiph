import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseClient } from '@tahi/database';
import { Redis } from 'ioredis';
import { UNSCOPED_PRISMA } from '../../core/database/database.module.js';
import { REDIS } from '../../core/redis/redis.module.js';

export type CheckStatus = 'up' | 'down';
export interface HealthReport {
  status: 'ok' | 'error';
  checks: Record<string, CheckStatus>;
}

const CHECK_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref()),
  ]);
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async readiness(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([
      this.check(() => this.prisma.$queryRaw`SELECT 1`),
      this.check(async () => {
        if (this.redis.status === 'wait') await this.redis.connect();
        return this.redis.ping();
      }),
    ]);
    const checks = { database, redis };
    const status = Object.values(checks).every((c) => c === 'up') ? 'ok' : 'error';
    return { status, checks };
  }

  private async check(fn: () => Promise<unknown>): Promise<CheckStatus> {
    try {
      await withTimeout(fn(), CHECK_TIMEOUT_MS);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
