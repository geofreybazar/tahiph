import { describe, expect, it } from 'vitest';
import {
  MemoryRateLimitStore,
  RateLimiter,
  TooManyRequestsError,
  type RateLimitStore,
} from './rate-limit.js';

describe('RateLimiter', () => {
  it('allows up to the limit within a window, then rejects', async () => {
    const rl = new RateLimiter(new MemoryRateLimitStore());
    for (let i = 0; i < 3; i++) await rl.consume('k', { limit: 3, windowMs: 60_000 });
    await expect(rl.consume('k', { limit: 3, windowMs: 60_000 })).rejects.toBeInstanceOf(
      TooManyRequestsError,
    );
    await rl.consume('other', { limit: 3, windowMs: 60_000 });
  });

  it('starts a growing backoff from the fifth login failure, and clears on success', async () => {
    const store = new MemoryRateLimitStore();
    const rl = new RateLimiter(store);
    for (let i = 0; i < 4; i++) await rl.recordLoginFailure('a@b.ph');
    await rl.assertAccountNotLocked('a@b.ph');
    await rl.recordLoginFailure('a@b.ph');
    await expect(rl.assertAccountNotLocked('a@b.ph')).rejects.toBeInstanceOf(TooManyRequestsError);
    const first = await store.ttl('tahi:lock:a@b.ph');
    await rl.recordLoginFailure('a@b.ph');
    expect(await store.ttl('tahi:lock:a@b.ph')).toBeGreaterThan(first);
    await rl.clearLoginFailures('a@b.ph');
    await rl.assertAccountNotLocked('a@b.ph');
  });

  it('fails open when the store is unavailable', async () => {
    const broken: RateLimitStore = {
      incr: () => Promise.reject(new Error('down')),
      ttl: () => Promise.reject(new Error('down')),
      set: () => Promise.reject(new Error('down')),
      del: () => Promise.reject(new Error('down')),
    };
    const rl = new RateLimiter(broken);
    await rl.consume('k', { limit: 0, windowMs: 1000 });
    await rl.assertAccountNotLocked('a');
    expect(await rl.recordLoginFailure('a')).toBe(0);
  });
});
