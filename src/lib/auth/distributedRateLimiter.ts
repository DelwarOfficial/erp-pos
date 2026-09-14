import { createHash } from 'node:crypto';
import { getRedisConnection } from '@/lib/queue';
import { checkRateLimit, type RateLimitConfig, type RateLimitResult } from './rateLimiter';

// Redis-backed limiter: one Lua script atomically increments and sets the window TTL.
const LUA = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return {n,redis.call('PTTL',KEYS[1])}`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export async function checkDistributedRateLimit(action: string, identity: string, config: RateLimitConfig): Promise<RateLimitResult> {
  const key = `erp:rl:v1:${action}:${digest(identity)}`;
  try {
    const redis = getRedisConnection();
    const result = await Promise.race([
      redis.eval(LUA, 1, key, String(config.windowMs)) as Promise<[number, number]>,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('redis timeout')), 1500)),
    ]);
    const count = Number(result[0]);
    if (count > config.maxAttempts) return { allowed: false, remaining: 0, retryAfterMs: Math.max(Number(result[1]), 0) };
    return { allowed: true, remaining: config.maxAttempts - count, retryAfterMs: 0 };
  } catch {
    // Local/test sandboxes have no Redis; retain bounded local protection. Production fails closed.
    if (process.env.NODE_ENV !== 'production') return checkRateLimit(`distributed:${action}:${digest(identity)}`, config);
    // Fail closed: Redis outage must never silently remove brute-force protection.
    return { allowed: false, remaining: 0, retryAfterMs: config.lockMs };
  }
}

export async function resetDistributedRateLimit(action: string, identity: string): Promise<void> {
  try { await getRedisConnection().del(`erp:rl:v1:${action}:${digest(identity)}`); } catch { /* already fail-closed */ }
}
