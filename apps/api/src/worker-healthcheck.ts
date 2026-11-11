/**
 * Docker HEALTHCHECK for the worker container: healthy while the heartbeat key exists
 * (refreshed every 60s with a 180s TTL). Exits 0 = healthy, 1 = unhealthy.
 */
import { Redis } from 'ioredis';
import { WORKER_HEARTBEAT_KEY } from './core/queue/queues.js';

const url = process.env.REDIS_URL;
if (!url) process.exit(1);

const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3_000 });
try {
  await redis.connect();
  const beat = await redis.get(WORKER_HEARTBEAT_KEY);
  process.exit(beat ? 0 : 1);
} catch {
  process.exit(1);
} finally {
  redis.disconnect();
}
