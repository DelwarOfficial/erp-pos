// src/lib/auth/rateLimiter.ts
// Simple in-memory rate limiter for auth endpoints.
// Prevents brute-force attacks on MFA verify, login, password reset.
//
// For production with multiple instances, replace with Redis-backed limiter.
// Per-IP + per-user tracking with progressive backoff.

interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  lastAttempt: number;
  lockedUntil?: number;
}

const STORE = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of STORE) {
    if (now - entry.lastAttempt > 30 * 60 * 1000) { // 30 min idle
      STORE.delete(key);
    }
  }
}, 5 * 60 * 1000).unref?.();

export interface RateLimitConfig {
  /** Max attempts within the window */
  maxAttempts: number;
  /** Window in ms */
  windowMs: number;
  /** Lock duration after max exceeded (ms) */
  lockMs: number;
  /** Progressive lock: each subsequent lockout doubles, up to this cap */
  maxLockMs: number;
}

export const DEFAULT_LOGIN_LIMIT: RateLimitConfig = {
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000, // 15 min
  lockMs: 5 * 60 * 1000, // 5 min
  maxLockMs: 60 * 60 * 1000, // 1 hour
};

export const DEFAULT_MFA_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 5 * 60 * 1000, // 5 min
  lockMs: 15 * 60 * 1000, // 15 min
  maxLockMs: 2 * 60 * 60 * 1000, // 2 hours
};

export const DEFAULT_PASSWORD_RESET_LIMIT: RateLimitConfig = {
  maxAttempts: 3,
  windowMs: 60 * 60 * 1000, // 1 hour
  lockMs: 60 * 60 * 1000, // 1 hour
  maxLockMs: 24 * 60 * 60 * 1000, // 24 hours
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  lockedUntil?: number;
}

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  const now = Date.now();
  let entry = STORE.get(key);

  // Check if currently locked
  if (entry?.lockedUntil && entry.lockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: entry.lockedUntil - now,
      lockedUntil: entry.lockedUntil,
    };
  }

  // Reset if lock expired or window passed
  if (entry?.lockedUntil && entry.lockedUntil <= now) {
    // Lock expired — but keep the count to allow progressive backoff
    entry.lockedUntil = undefined;
    entry.count = 0;
    entry.firstAttempt = now;
  }

  if (!entry || (now - entry.firstAttempt) > config.windowMs) {
    entry = {
      count: 0,
      firstAttempt: now,
      lastAttempt: now,
    };
    STORE.set(key, entry);
  }

  entry.count++;
  entry.lastAttempt = now;

  if (entry.count > config.maxAttempts) {
    // Lock the user — progressive backoff
    const previousLocks = Math.floor(entry.count / config.maxAttempts) - 1;
    const lockDuration = Math.min(
      config.lockMs * Math.pow(2, previousLocks),
      config.maxLockMs,
    );
    entry.lockedUntil = now + lockDuration;
    STORE.set(key, entry);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: lockDuration,
      lockedUntil: entry.lockedUntil,
    };
  }

  STORE.set(key, entry);
  return {
    allowed: true,
    remaining: config.maxAttempts - entry.count,
    retryAfterMs: 0,
  };
}

export function resetRateLimit(key: string): void {
  STORE.delete(key);
}

/**
 * Build a composite key for per-user + per-IP tracking.
 * Format: "user:<userId>:ip:<ip>" or "ip:<ip>" if no userId.
 */
export function buildRateLimitKey(action: string, ip?: string, userId?: string): string {
  if (userId) return `${action}:user:${userId}:ip:${ip ?? 'unknown'}`;
  return `${action}:ip:${ip ?? 'unknown'}`;
}
