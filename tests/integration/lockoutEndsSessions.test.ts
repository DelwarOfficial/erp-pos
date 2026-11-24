// Red-team workstream 4: locking an account must end the sessions it already
// has. lockedUntil used to be checked only at sign-in, so a locked account's
// refresh token kept it signed in for up to 30 days. Disposable MariaDB; the
// Redis rate limiter and the request cookie store are stubbed, everything
// else (password check, lockout, tokens) runs for real.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const jar = vi.hoisted(() => ({ access: '' }));
vi.mock('next/headers', async importOriginal => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  cookies: async () => ({ set: () => undefined, delete: () => undefined, get: (name: string) => (name.includes('refresh') || !jar.access ? undefined : { name, value: jar.access }) }),
}));
vi.mock('@/lib/auth/distributedRateLimiter', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth/distributedRateLimiter')>()),
  checkDistributedRateLimit: async () => ({ allowed: true, unavailable: false }),
}));
import { POST as login } from '@/app/api/v1/auth/login/route';
import { POST as refresh } from '@/app/api/v1/auth/refresh/route';
import { authenticateRequest } from '@/lib/auth/middleware';
import { hashPassword } from '@/lib/auth/password';
import { issueRefreshToken } from '@/lib/auth/refreshToken';
import { issueAccessToken } from '@/lib/auth/jwt';
import { getAccessCookieName, getRefreshCookieName } from '@/lib/auth/cookieNames';

const db = new PrismaClient();
const COMPANY_ID = 'f4d8b3c2-3d44-4f60-ab52-8d9e0f1a2b34';
const PASSWORD = `Synthetic-${randomUUID()}`;
let userId: string;
let email: string;

async function session() {
  const issued = await issueRefreshToken({ companyId: COMPANY_ID, userId });
  jar.access = await issueAccessToken({ sub: userId, company_id: COMPANY_ID, scope: 'global', is_global: false, branch_ids: [],
    session_id: issued.sessionId ?? randomUUID(), family_id: issued.familyId, mfa_verified: false });
  return issued;
}
const refreshWith = (token: string) => refresh(new NextRequest('http://local.test/api/v1/auth/refresh', {
  method: 'POST', headers: { Cookie: `${getRefreshCookieName()}=${token}`, Origin: 'http://local.test' } }));
const signIn = (password: string) => login(new NextRequest('http://local.test/api/v1/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://local.test' },
  body: JSON.stringify({ email, password, company_code: 'SYN-LK' }) }));
const code = async (res: Response) => ((await res.json()) as { error?: { code?: string } }).error?.code;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'LK', code: 'SYN-LK' });
  email = `${randomUUID()}@example.invalid`;
  userId = (await db.user.create({ data: { companyId: COMPANY_ID, name: 'Lockable', email, passwordHash: await hashPassword(PASSWORD), accessScope: 'global' } })).id;
}, 120_000);
afterAll(() => db.$disconnect());

describe('account lockout', () => {
  it('a live session works before the lock', async () => {
    await session();
    expect((await authenticateRequest()).userId).toBe(userId);
  });

  it('five bad passwords lock the account and end its existing sessions', async () => {
    const before = await session();
    for (let i = 0; i < 5; i++) expect((await signIn('wrong-password')).status).toBe(401);
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // The access token issued before the lock is refused on the next request.
    await expect(authenticateRequest()).rejects.toMatchObject({ httpStatus: 401 });
    // The refresh token cannot mint new tokens.
    const res = await refreshWith(before.token);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie') ?? '').not.toContain(`${getAccessCookieName()}=ey`);
    expect(await db.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    // Sign-in stays refused while locked, even with the right password.
    expect(await code(await signIn(PASSWORD))).toBe('ACCOUNT_LOCKED');
  });

  it('refuses a session for a lock set some other way', async () => {
    const issued = await session();
    await db.user.update({ where: { id: userId }, data: { lockedUntil: new Date(Date.now() + 60_000), failedLoginCount: 5 } });
    await expect(authenticateRequest()).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    expect(await code(await refreshWith(issued.token))).toBe('ACCOUNT_LOCKED');
  });

  it('after the lock ends, the right password signs in again', async () => {
    await db.user.update({ where: { id: userId }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
    const res = await signIn(PASSWORD);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).lockedUntil).toBeNull();
  });
});
