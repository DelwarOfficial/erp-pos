import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authenticator } from '@otplib/preset-default';
import { setupMfa } from '@/lib/auth/mfa';
import { issueMfaChallenge, readMfaChallenge } from '@/lib/auth/mfaChallenge';
import { MFA_PENDING_COOKIE_NAME } from '@/lib/auth/cookieNames';

const state = vi.hoisted(() => ({ cookie: '', failPreparation: false }));
vi.mock('next/headers', () => ({ cookies: async () => ({
  get: (name: string) => name === 'erp_mfa_pending' ? { value: state.cookie } : undefined,
  set: () => { throw new Error('Cookies must not mutate request state before commit'); },
}) }));
vi.mock('@/lib/auth/distributedRateLimiter', () => ({
  checkDistributedRateLimit: async () => ({ allowed: true, remaining: 4, retryAfterMs: 0 }),
  resetDistributedRateLimit: async () => false,
}));
vi.mock('@/lib/auth/sessions', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/auth/sessions')>();
  return { ...original, setAuthCookies: async (params: Parameters<typeof original.setAuthCookies>[0]) => {
    if (state.failPreparation) throw new Error('synthetic signing failure');
    return original.setAuthCookies(params);
  } };
});
import { POST } from '@/app/api/v1/auth/mfa/verify/route';
const db = new PrismaClient();
let companyId: string;
let userId: string;
let familyId: string;
let secret: string;
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_disposable'))
    throw new Error('Local disposable MariaDB required');
  const versions = await db.$queryRaw<Array<{ version: string }>>`SELECT VERSION() AS version`;
  expect(versions[0].version).toMatch(/^11\.8\..*MariaDB/);
  const company = await db.company.create({ data: {
    code: 'MFA-P1-' + randomUUID(), legalName: 'Synthetic', displayName: 'Synthetic', baseCurrencyCode: 'BDT',
  } });
  companyId = company.id;
  const email = randomUUID() + '@example.invalid';
  const setup = setupMfa({ userEmail: email });
  secret = setup.secret;
  const user = await db.user.create({ data: {
    companyId, name: 'Synthetic', email, passwordHash: 'unused-synthetic',
    mfaEnabled: true, mfaSecretCiphertext: new Uint8Array(setup.ciphertext),
  } });
  userId = user.id;
});
beforeEach(async () => {
  familyId = randomUUID(); state.failPreparation = false;
  state.cookie = await issueMfaChallenge({ companyId, userId, familyId });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.$disconnect());
const request = () => new NextRequest('http://localhost/api/v1/auth/mfa/verify', {
  method: 'POST', body: JSON.stringify({ code: authenticator.generate(secret) }),
});
it('MariaDB: Redis reset failure still returns one committed MFA session and rejects replay', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toContain(MFA_PENDING_COOKIE_NAME + '=;');
  expect(await db.refreshToken.count({ where: { companyId, userId, familyId, mfaVerified: true } })).toBe(1);
  expect(await readMfaChallenge(state.cookie)).toBeNull();
  expect((await POST(request())).status).toBe(401);
  expect(await db.refreshToken.count({ where: { companyId, userId, familyId } })).toBe(1);
});
it('MariaDB: cookie preparation failure rolls back session but not consumed challenge', async () => {
  state.failPreparation = true;
  expect((await POST(request())).status).toBe(500);
  expect(await db.refreshToken.count({ where: { companyId, userId, familyId } })).toBe(0);
  expect(await readMfaChallenge(state.cookie)).toBeNull();
  expect((await POST(request())).status).toBe(401);
});
it('MariaDB: concurrent MFA verification creates one session and one success audit', async () => {
  const results = await Promise.all([POST(request()), POST(request())]);
  expect(results.map(r => r.status).sort()).toEqual([200, 401]);
  const tokens = await db.refreshToken.findMany({ where: { companyId, userId, familyId } });
  expect(tokens).toHaveLength(1);
  const events = await db.securityEvent.findMany({ where: { companyId, userId, eventType: 'mfa_success' } });
  expect(events.filter(e => JSON.parse(e.metadata).session_id === tokens[0].sessionId)).toHaveLength(1);
});
