// F-70: the worker's Redis heartbeat, written by src/workers/index.ts and read
// by the health check.
import { describe, expect, it } from 'vitest';
import {
  clearWorkerHeartbeat, readWorkerHealth, workerHealthRequired, writeWorkerHeartbeat,
  WORKER_HEARTBEAT_INTERVAL_MS, WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_STALE_MS,
} from '@/lib/health/workerHeartbeat';

/** Enough of Redis for the heartbeat, with real key expiry against a clock. */
function fakeRedis() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  let now = 1_000_000;
  return {
    advance(ms: number) { now += ms; },
    get now() { return now; },
    async set(key: string, value: string, _mode: 'PX', ttl: number) { store.set(key, { value, expiresAt: now + ttl }); return 'OK'; },
    async get(key: string) { const e = store.get(key); return e && e.expiresAt > now ? e.value : null; },
    async del(key: string) { return store.delete(key) ? 1 : 0; },
  };
}

describe('worker heartbeat', () => {
  it('reads healthy while the worker keeps beating', async () => {
    const redis = fakeRedis();
    for (let i = 0; i < 10; i++) {
      expect(await writeWorkerHeartbeat(redis, true, redis.now)).toBe(true);
      redis.advance(WORKER_HEARTBEAT_INTERVAL_MS);
      expect(await readWorkerHealth(redis, redis.now)).toBe('ok');
    }
  });

  it('fails once a stopped worker\'s last beat expires', async () => {
    const redis = fakeRedis();
    await writeWorkerHeartbeat(redis, true, redis.now);
    redis.advance(WORKER_HEARTBEAT_STALE_MS - 1);
    expect(await readWorkerHealth(redis, redis.now)).toBe('ok');
    redis.advance(2);
    expect(await readWorkerHealth(redis, redis.now)).toBe('fail');
  });

  it('withholds the beat while any worker is not running', async () => {
    const redis = fakeRedis();
    expect(await writeWorkerHeartbeat(redis, false, redis.now)).toBe(false);
    expect(await readWorkerHealth(redis, redis.now)).toBe('fail');
  });

  it('fails at once after a clean shutdown', async () => {
    const redis = fakeRedis();
    await writeWorkerHeartbeat(redis, true, redis.now);
    await clearWorkerHeartbeat(redis);
    expect(await readWorkerHealth(redis, redis.now)).toBe('fail');
  });

  it('refuses a garbled or far-future beat', async () => {
    const redis = fakeRedis();
    await redis.set(WORKER_HEARTBEAT_KEY, 'not-a-time', 'PX', 60_000);
    expect(await readWorkerHealth(redis, redis.now)).toBe('fail');
    await redis.set(WORKER_HEARTBEAT_KEY, String(redis.now + 10 * WORKER_HEARTBEAT_STALE_MS), 'PX', 60_000);
    expect(await readWorkerHealth(redis, redis.now)).toBe('fail');
  });

  it('is required in production with Redis, and not where delivery runs in-process', () => {
    expect(workerHealthRequired({ NODE_ENV: 'production', REDIS_URL: 'redis://r' } as never)).toBe(true);
    expect(workerHealthRequired({ NODE_ENV: 'development', REDIS_URL: 'redis://r' } as never)).toBe(false);
    expect(workerHealthRequired({ NODE_ENV: 'production' } as never)).toBe(false);
    expect(workerHealthRequired({ NODE_ENV: 'test', WORKER_HEALTH_REQUIRED: 'true' } as never)).toBe(true);
  });
});
