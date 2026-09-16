import { createHash } from 'node:crypto';
import { createRateLimitRedis } from './rateLimitRedis';
import { checkRateLimit, type RateLimitConfig, type RateLimitResult } from './rateLimiter';

// Redis-backed limiter: one Lua script atomically increments and sets the window TTL.
const LUA = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return {n,redis.call('PTTL',KEYS[1])}`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function withRedis<T>(operation: (client: ReturnType<typeof createRateLimitRedis>) => Promise<T>): Promise<T> {
  const client = createRateLimitRedis();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => { await client.connect(); return operation(client); })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('RATE_LIMIT_UNAVAILABLE')), 1500); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    client.disconnect(); // Cancel pending commands; timed-out requests must not replay on reconnect.
  }
}

export async function checkDistributedRateLimit(action: string, identity: string, config: RateLimitConfig): Promise<RateLimitResult> {
  const key = `erp:rl:v1:${action}:${digest(identity)}`;
  try {
    const result = await withRedis(redis => redis.eval(LUA, 1, key, String(config.windowMs)) as Promise<[number, number]>);
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

export async function resetDistributedRateLimit(action: string, identity: string): Promise<boolean> {
  try { await withRedis(redis => redis.del(`erp:rl:v1:${action}:${digest(identity)}`)); return true; }
  catch { return false; } // Retain quota until TTL. Failed cleanup never relaxes the limit.
}
