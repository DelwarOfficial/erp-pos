// With the shared limiter down, sign-in fails closed with 503
// AUTH_SERVICE_UNAVAILABLE: not "too many attempts" (429), not "wrong
// password" (401), and before any account is looked up.
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const lookups = vi.hoisted(() => ({ users: 0 }));
vi.mock('@/lib/auth/distributedRateLimiter', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth/distributedRateLimiter')>()),
  checkDistributedRateLimit: async () => ({ allowed: false, remaining: 0, retryAfterMs: 500, unavailable: true }),
}));
vi.mock('@/lib/db', () => ({ db: { user: { findMany: async () => { lookups.users++; return []; } }, company: { findFirst: async () => ({ id: 'p' }) } } }));

import { POST as login } from '@/app/api/v1/auth/login/route';

describe('login when the rate limiter is unreachable', () => {
  it('answers 503 AUTH_SERVICE_UNAVAILABLE with no internals and looks up no account', async () => {
    const response = await login(new NextRequest('http://localhost/api/v1/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'someone@example.invalid', password: 'synthetic-password-1' }),
    }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe('AUTH_SERVICE_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toMatch(/redis|ECONN|stack/i);
    expect(lookups.users).toBe(0);
  });
});
