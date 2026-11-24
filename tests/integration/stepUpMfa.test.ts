// Red-team workstream 5: step-up MFA must really re-verify.
//   - freshness comes from refresh_tokens.mfa_verified_at (60 minutes), not the
//     JWT claim that refresh rotation copied forward for 30 days;
//   - POST /api/v1/auth/mfa/step-up re-checks the code mid-session;
//   - every declared step-up action is enforced by a route;
//   - accountant / branch_manager / hr_manager must enrol MFA at sign-in.
// Disposable MariaDB; the Redis limiter and the cookie store are stubbed.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { authenticator } from '@otplib/preset-default';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const jar = vi.hoisted(() => ({ access: '' }));
vi.mock('next/headers', async importOriginal => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  cookies: async () => ({ set: () => undefined, delete: () => undefined,
    get: (name: string) => (name.includes('refresh') || !jar.access ? undefined : { name, value: jar.access }) }),
}));
vi.mock('@/lib/auth/distributedRateLimiter', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth/distributedRateLimiter')>()),
  checkDistributedRateLimit: async () => ({ allowed: true, unavailable: false, remaining: 5, retryAfterMs: 0 }),
  resetDistributedRateLimit: async () => true,
}));
import { MFA_REQUIRED_ACTIONS, MFA_STEP_UP_WINDOW_MS, requireMfaForAction } from '@/lib/auth/requireMfa';
import { POST as stepUp } from '@/app/api/v1/auth/mfa/step-up/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { POST as postTransfer } from '@/app/api/v1/account-transfers/route';
import { POST as postTaxCode } from '@/app/api/v1/tax-codes/route';
import { POST as postTaxComponent } from '@/app/api/v1/tax-components/route';
import { GET as downloadExport } from '@/app/api/v1/export-jobs/[id]/download/route';
import { setupMfa } from '@/lib/auth/mfa';
import { hashPassword } from '@/lib/auth/password';
import { issueRefreshToken, rotateRefreshToken } from '@/lib/auth/refreshToken';
import { issueAccessToken } from '@/lib/auth/jwt';

const db = new PrismaClient();
const COMPANY_ID = 'a5e9c4d3-4e55-4a71-bc63-9e0f1a2b3c45';
let userId: string;
let secret: string;
const req = new NextRequest('http://local.test/x');

async function session(mfaVerifiedAt: Date | null) {
  const issued = await issueRefreshToken({ companyId: COMPANY_ID, userId, mfaVerified: !!mfaVerifiedAt, mfaVerifiedAt });
  jar.access = await issueAccessToken({ sub: userId, company_id: COMPANY_ID, scope: 'global', is_global: false, branch_ids: [],
    session_id: issued.sessionId ?? randomUUID(), family_id: issued.familyId, mfa_verified: true });
  return issued;
}
const json = (url: string, body: unknown, method = 'POST') => new NextRequest(`http://local.test${url}`, {
  method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `t-${randomUUID()}`, Origin: 'http://local.test' }, body: JSON.stringify(body) });
const errorOf = async (res: Response) => ((await res.json()) as { error?: { code?: string; details?: Record<string, unknown> } }).error;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'MF', code: 'SYN-MF' });
  const mfa = setupMfa({ userEmail: 'mfa@example.invalid' });
  secret = mfa.secret;
  const perms = await db.permission.findMany({ where: { code: { in: ['account_transfer.post', 'tax.manage', 'export.data.branch'] } } });
  const role = await db.role.create({ data: { companyId: COMPANY_ID, name: `stepup-${randomUUID().slice(0, 6)}`, permissions: { create: perms.map(p => ({ permissionId: p.id })) } } });
  userId = (await db.user.create({ data: { companyId: COMPANY_ID, name: 'Step-up', email: `${randomUUID()}@example.invalid`, passwordHash: 'x', accessScope: 'global',
    mfaEnabled: true, mfaSecretCiphertext: new Uint8Array(mfa.ciphertext), roles: { create: { roleId: role.id } } } })).id;
}, 120_000);
afterAll(() => db.$disconnect());

describe('freshness', () => {
  it('passes within the window and fails after it, whatever the JWT claim says', async () => {
    await session(new Date(Date.now() - 5 * 60_000));
    await expect(requireMfaForAction(req, 'tax_rule_change')).resolves.toBeUndefined();
    await session(new Date(Date.now() - MFA_STEP_UP_WINDOW_MS - 60_000));
    await expect(requireMfaForAction(req, 'tax_rule_change')).rejects.toMatchObject({ code: 'INVALID_MFA', details: { step_up: true } });
    await session(null);
    await expect(requireMfaForAction(req, 'tax_rule_change')).rejects.toMatchObject({ code: 'INVALID_MFA' });
  });

  it('refresh rotation carries the old check time forward, never renews it', async () => {
    const old = new Date(Date.now() - 2 * MFA_STEP_UP_WINDOW_MS);
    const issued = await session(old);
    const rotated = await rotateRefreshToken({ presentedToken: issued.token, companyId: COMPANY_ID, userId });
    expect(rotated.mfaVerifiedAt?.getTime()).toBe(old.getTime());
    await expect(requireMfaForAction(req, 'sensitive_export')).rejects.toMatchObject({ code: 'INVALID_MFA' });
  });
});

describe('POST /api/v1/auth/mfa/step-up', () => {
  it('refuses a wrong code with 400, accepts the right one, then step-up actions pass', async () => {
    const issued = await session(null);
    const wrong = await stepUp(json('/api/v1/auth/mfa/step-up', { code: '000000' === authenticator.generate(secret) ? '111111' : '000000' }));
    expect(wrong.status).toBe(400);
    const ok = await stepUp(json('/api/v1/auth/mfa/step-up', { code: authenticator.generate(secret) }));
    expect(ok.status).toBe(200);
    const row = await db.refreshToken.findFirstOrThrow({ where: { familyId: issued.familyId, revokedAt: null } });
    expect(Date.now() - row.mfaVerifiedAt!.getTime()).toBeLessThan(60_000);
    await expect(requireMfaForAction(req, 'account_transfer_approval')).resolves.toBeUndefined();
  });
});

describe('enforced actions', () => {
  // A stale session is refused at the step-up check; a fresh one gets past it
  // (it may then fail validation on these empty bodies, which is fine).
  const routes: Array<[string, () => Promise<Response>]> = [
    ['account_transfer_approval', () => postTransfer(json('/api/v1/account-transfers', {}))],
    ['tax_rule_change (tax code)', () => postTaxCode(json('/api/v1/tax-codes', {}))],
    ['tax_rule_change (tax component)', () => postTaxComponent(json('/api/v1/tax-components', {}))],
    ['sensitive_export', () => downloadExport(new NextRequest(`http://local.test/api/v1/export-jobs/${randomUUID()}/download`), { params: Promise.resolve({ id: randomUUID() }) })],
  ];
  it.each(routes)('%s needs a fresh check', async (_name, call) => {
    await session(new Date(Date.now() - 2 * MFA_STEP_UP_WINDOW_MS));
    const stale = await call();
    expect(stale.status).toBe(403);
    expect((await errorOf(stale))?.details).toMatchObject({ step_up: true });
    await session(new Date());
    expect((await errorOf(await call()))?.code).not.toBe('INVALID_MFA');
  });

  it('every declared action except backup_download is enforced by some route', () => {
    const sources: string[] = [];
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(name)) sources.push(readFileSync(p, 'utf8')); } };
    walk('src/app/api'); walk('src/lib/approval');
    const enforced = new Set(sources.flatMap(s => [...s.matchAll(/requireMfaForAction\(req, '([a-z_]+)'\)/g)].map(m => m[1])));
    // No backup-download route exists yet; whoever adds one must enforce it.
    expect(MFA_REQUIRED_ACTIONS.filter(a => !enforced.has(a))).toEqual(['backup_download']);
  });
});

describe('MFA-mandatory roles at sign-in', () => {
  it.each(['accountant', 'branch_manager', 'hr_manager'])('%s without MFA is sent to enrolment', async roleName => {
    const password = `Synthetic-${randomUUID()}`;
    const role = await db.role.findFirst({ where: { companyId: COMPANY_ID, name: roleName } })
      ?? await db.role.create({ data: { companyId: COMPANY_ID, name: roleName, isSystemRole: true } });
    const email = `${randomUUID()}@example.invalid`;
    await db.user.create({ data: { companyId: COMPANY_ID, name: roleName, email, passwordHash: await hashPassword(password), accessScope: 'branch',
      roles: { create: { roleId: role.id } } } });
    const res = await login(json('/api/v1/auth/login', { email, password, company_code: 'SYN-MF' }));
    expect(await res.json()).toMatchObject({ mfa_setup_required: true });
  });
});
