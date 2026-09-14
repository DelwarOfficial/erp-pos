import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ keys: new Map<string, { count: number; expires: number }>(), fail: false }));
vi.mock('@/lib/queue', () => ({ getRedisConnection: () => ({
  eval: async (_script: string, _n: number, key: string, windowMs: string) => {
    if (state.fail) throw new Error('offline');
    const now = Date.now(); const current = state.keys.get(key);
    if (!current || current.expires <= now) state.keys.set(key, { count: 1, expires: now + Number(windowMs) });
    else current.count++;
    const value = state.keys.get(key)!; return [value.count, value.expires - now];
  },
  del: async (key: string) => { state.keys.delete(key); return 1; },
}) }));

import { checkDistributedRateLimit, resetDistributedRateLimit } from '@/lib/auth/distributedRateLimiter';
const cfg = { maxAttempts: 5, windowMs: 1000, lockMs: 500, maxLockMs: 1000 };

describe('distributed rate limiter', () => {
  beforeEach(() => { state.keys.clear(); state.fail = false; vi.stubEnv('NODE_ENV', 'test'); });
  it('counts atomically across independent instances and enforces the shared limit', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => checkDistributedRateLimit('login', 'shared-identity', cfg)));
    expect(results.filter(r => r.allowed)).toHaveLength(5);
    expect(results.filter(r => !r.allowed)).toHaveLength(5);
  });
  it('preserves TTL across increments and expires the key', async () => {
    const first = await checkDistributedRateLimit('mfa', 'same-user', cfg);
    const second = await checkDistributedRateLimit('mfa', 'same-user', cfg);
    expect(first.allowed && second.allowed).toBe(true);
    const key = [...state.keys.values()][0]; expect(key.expires > Date.now()).toBe(true);
    key.expires = Date.now() - 1;
    expect((await checkDistributedRateLimit('mfa', 'same-user', cfg)).allowed).toBe(true);
  });
  it('reset removes shared state', async () => {
    for (let i = 0; i < 6; i++) await checkDistributedRateLimit('reset', 'identity', cfg);
    expect((await checkDistributedRateLimit('reset', 'identity', cfg)).allowed).toBe(false);
    await resetDistributedRateLimit('reset', 'identity');
    expect((await checkDistributedRateLimit('reset', 'identity', cfg)).allowed).toBe(true);
  });
  it('fails closed in production when Redis is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'production'); state.fail = true;
    const result = await checkDistributedRateLimit('login', 'private@example.invalid', cfg);
    expect(result.allowed).toBe(false); expect(result.retryAfterMs).toBe(cfg.lockMs);
  });
  it('uses bounded local fallback outside production and never becomes unlimited', async () => {
    state.fail = true;
    const results = await Promise.all(Array.from({ length: 7 }, () => checkDistributedRateLimit('mfa', 'sandbox', cfg)));
    expect(results.filter(r => r.allowed)).toHaveLength(5);
    expect(results.filter(r => !r.allowed)).toHaveLength(2);
  });
});
