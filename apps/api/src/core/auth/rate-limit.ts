import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { DomainError } from '../http/domain-error.js';
import { REDIS } from '../redis/redis.module.js';

export class TooManyRequestsError extends DomainError {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      'RATE_LIMITED',
      `Too many attempts. Try again in ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minute(s).`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** Minimal counter store. Redis in production; in-memory in tests. */
export interface RateLimitStore {
  /** Increments key, starting a window of ttlMs on first hit. Returns count and remaining ms. */
  incr(key: string, ttlMs: number): Promise<{ count: number; ttlMs: number }>;
  /** Remaining ms of a key, or 0 if absent. */
  ttl(key: string): Promise<number>;
  set(key: string, ttlMs: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
}

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}

  async incr(key: string, ttlMs: number) {
    const res = await this.redis.multi().incr(key).pexpire(key, ttlMs, 'NX').pttl(key).exec();
    if (!res) throw new Error('rate limit transaction aborted');
    const count = Number(res[0]?.[1]);
    const ttl = Number(res[2]?.[1]);
    return { count, ttlMs: ttl > 0 ? ttl : ttlMs };
  }

  async ttl(key: string) {
    return Math.max(0, await this.redis.pttl(key));
  }

  async set(key: string, ttlMs: number) {
    await this.redis.set(key, '1', 'PX', ttlMs);
  }

  async del(...keys: string[]) {
    if (keys.length) await this.redis.del(...keys);
  }
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();

  private live(key: string) {
    const e = this.entries.get(key);
    if (e && e.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e;
  }

  incr(key: string, ttlMs: number) {
    const e = this.live(key) ?? { count: 0, expiresAt: Date.now() + ttlMs };
    e.count++;
    this.entries.set(key, e);
    return Promise.resolve({ count: e.count, ttlMs: e.expiresAt - Date.now() });
  }

  ttl(key: string) {
    const e = this.live(key);
    return Promise.resolve(e ? e.expiresAt - Date.now() : 0);
  }

  set(key: string, ttlMs: number) {
    this.entries.set(key, { count: 1, expiresAt: Date.now() + ttlMs });
    return Promise.resolve();
  }

  del(...keys: string[]) {
    for (const k of keys) this.entries.delete(k);
    return Promise.resolve();
  }
}

export const redisRateLimitStoreProvider = {
  provide: RATE_LIMIT_STORE,
  inject: [REDIS],
  useFactory: (redis: Redis) => new RedisRateLimitStore(redis),
};

const MIN = 60_000;

/** Initial limits (docs/AUTHENTICATION_AND_AUTHORIZATION.md §5). */
export const LIMITS = {
  loginPerIp: { limit: 20, windowMs: 15 * MIN },
  emailSendPerAddress: { limit: 3, windowMs: 15 * MIN },
  emailSendPerIp: { limit: 20, windowMs: 60 * MIN },
  tokenPerIp: { limit: 20, windowMs: 15 * MIN },
  /** Failures before the per-account backoff starts, and its cap. */
  accountFailuresBeforeBackoff: 5,
  accountBackoffMaxMs: 60 * MIN,
  accountFailureWindowMs: 60 * MIN,
} as const;

/**
 * Throttling. Fails open if the store is unavailable (logged): Redis outages must not lock
 * every user out. Readiness reports Redis down, and Cloudflare rate limiting stays in front.
 */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);

  constructor(@Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore) {}

  async consume(key: string, rule: { limit: number; windowMs: number }): Promise<void> {
    let hit: { count: number; ttlMs: number };
    try {
      hit = await this.store.incr(`tahi:rl:${key}`, rule.windowMs);
    } catch (err) {
      this.logger.error({ err }, 'rate limit store unavailable; allowing request');
      return;
    }
    if (hit.count > rule.limit) throw new TooManyRequestsError(Math.ceil(hit.ttlMs / 1000));
  }

  /** Throws while an account is in backoff after repeated login failures. */
  async assertAccountNotLocked(account: string): Promise<void> {
    let ttl = 0;
    try {
      ttl = await this.store.ttl(`tahi:lock:${account}`);
    } catch (err) {
      this.logger.error({ err }, 'rate limit store unavailable; allowing request');
    }
    if (ttl > 0) throw new TooManyRequestsError(Math.ceil(ttl / 1000));
  }

  /** Records a failure; from the 5th, locks the account for 1, 2, 4… minutes (capped at 60). */
  async recordLoginFailure(account: string): Promise<number> {
    try {
      const { count } = await this.store.incr(`tahi:lf:${account}`, LIMITS.accountFailureWindowMs);
      const over = count - LIMITS.accountFailuresBeforeBackoff;
      if (over >= 0) {
        await this.store.set(
          `tahi:lock:${account}`,
          Math.min(LIMITS.accountBackoffMaxMs, 2 ** over * MIN),
        );
      }
      if (count === 20) {
        const ref = createHash('sha256').update(account).digest('hex').slice(0, 12);
        this.logger.warn({ accountRef: ref }, 'repeated login failures for one account');
      }
      return count;
    } catch (err) {
      this.logger.error({ err }, 'rate limit store unavailable');
      return 0;
    }
  }

  async clearLoginFailures(account: string): Promise<void> {
    await this.store.del(`tahi:lf:${account}`, `tahi:lock:${account}`).catch(() => undefined);
  }
}
