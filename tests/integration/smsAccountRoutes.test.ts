// The SMS account and reminder policy routes on the disposable MariaDB; only
// authentication is stubbed. The MiMSMS key and login must never come back out:
// not in a response, not in the audit trail, not in clear in the database.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const A = randomUUID();
const B = randomUUID();
const KEY = 'SECRETKEY-9f8e7d6c';
const LOGIN = 'owner@shop-example.com';

const auth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: async () => auth.current,
  requirePermission: async () => undefined,
}));

const db = new PrismaClient();
const as = (companyId: string, userId: string) => {
  auth.current = { companyId, userId, isGlobal: false,
    ctx: { companyId, userId, branchIds: [], allBranches: true, isGlobal: false, correlationId: randomUUID(), requestId: randomUUID() } };
};
const call = async (path: string, method: 'GET' | 'PUT', body?: unknown) => {
  const route = await import(`@/app/api/v1/communications/${path}/route`);
  return route[method](new NextRequest(`http://localhost/api/v1/communications/${path}`, {
    method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'idempotency-key': `k-${randomUUID()}` } } : {}),
  }));
};
let userA: string;
let userB: string;

beforeAll(async () => {
  userA = (await ensureSyntheticIssuerTenant(db, { companyId: A, label: 'SA', code: `SYN-SA-${A.slice(0, 8)}` })).user.id;
  userB = (await ensureSyntheticIssuerTenant(db, { companyId: B, label: 'SB', code: `SYN-SB-${B.slice(0, 8)}` })).user.id;
}, 120_000);
afterAll(() => db.$disconnect());

describe('SMS account', () => {
  it('stores the credentials encrypted and never returns them', async () => {
    as(A, userA);
    const put = await call('sms-account', 'PUT', { user_name: LOGIN, api_key: KEY, sender_name: 'MYSHOP' });
    expect(put.status).toBe(200);
    const text = JSON.stringify(await put.json()) + JSON.stringify(await (await call('sms-account', 'GET')).json());
    expect(text).toContain('MYSHOP');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(LOGIN);

    const row = await db.integrationCredential.findFirstOrThrow({ where: { companyId: A, provider: 'mimsms' } });
    const stored = Buffer.from(row.credentialCiphertext).toString('latin1');
    expect(stored).not.toContain(KEY);
    expect(stored).not.toContain(LOGIN);

    // Nor in the idempotency record of the request.
    expect(JSON.stringify(await db.idempotencyRequest.findMany({ where: { companyId: A } }))).not.toContain(KEY);

    const audit = await db.auditLog.findMany({ where: { companyId: A, action: 'sms_account.update' } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(KEY);
    expect(JSON.stringify(audit)).not.toContain(LOGIN);
  });

  it('is per company: another company sees no account', async () => {
    as(B, userB);
    expect(await (await call('sms-account', 'GET')).json()).toEqual({ configured: false });
  });

  it('refuses an account that cannot be a MiMSMS login, without echoing the key', async () => {
    as(A, userA);
    const response = await call('sms-account', 'PUT', { user_name: 'not-an-email', api_key: KEY, sender_name: 'MYSHOP' });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain(KEY);
  });
});

describe('reminder policy', () => {
  it('reports defaults, off, until set', async () => {
    as(B, userB);
    expect(await (await call('reminder-policy', 'GET')).json()).toMatchObject({ configured: false, enabled: false });
  });

  it('saves a valid policy and audits the change', async () => {
    as(A, userA);
    const response = await call('reminder-policy', 'PUT', {
      enabled: true, stage_offsets: [7, -3, 0, 0], send_window_start_minute: 600, send_window_end_minute: 1140,
      min_outstanding: '50', max_per_customer_per_day: 1, daily_company_limit: 200, locale: 'bn',
    });
    expect(response.status).toBe(200);
    // Stages are de-duplicated and ordered.
    expect(await response.json()).toMatchObject({ enabled: true, stage_offsets: [-3, 0, 7], min_outstanding: '50.00' });
    expect(await db.auditLog.count({ where: { companyId: A, action: 'reminder_policy.update' } })).toBe(1);
  });

  it.each([
    ['a stage beyond the limits', { stage_offsets: [-60] }],
    ['a window that ends before it starts', { send_window_start_minute: 1200, send_window_end_minute: 600 }],
    ['a fractional amount of paisa', { min_outstanding: '1.005' }],
  ])('refuses %s', async (_label, change) => {
    as(A, userA);
    const response = await call('reminder-policy', 'PUT', {
      enabled: true, stage_offsets: [0], send_window_start_minute: 540, send_window_end_minute: 1200,
      min_outstanding: '1', max_per_customer_per_day: 1, daily_company_limit: 500, locale: 'bn', ...change,
    });
    expect(response.status).toBe(400);
  });
});
