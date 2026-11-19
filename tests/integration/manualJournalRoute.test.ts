// POST /api/v1/journal-entries against the disposable MariaDB (only the
// session is stubbed; permissions are checked for real):
//   - a company can post more than one manual journal (every manual entry
//     used to share one event key, so the second one always failed);
//   - an amount above the adjustment threshold needs approval.resolve, which
//     a poster with journal.post alone does not have.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const auth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/auth/middleware', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth/middleware')>()),
  authenticateRequest: async () => auth.current,
}));
import { POST } from '@/app/api/v1/journal-entries/route';

const db = new PrismaClient();
const COMPANY_ID = 'b4c6d7e8-f901-4b56-e789-a3b4c5d6e7f8';
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let manualAccount: string;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'MJ', code: 'SYN-MJ' });
  const code = await db.permission.findFirstOrThrow({ where: { code: 'journal.post' } });
  const role = await db.role.create({ data: { companyId: COMPANY_ID, name: `poster-${randomUUID().slice(0, 6)}`, permissions: { create: [{ permissionId: code.id }] } } });
  const user = await db.user.create({ data: { companyId: COMPANY_ID, name: 'Poster', email: `${randomUUID()}@example.invalid`, passwordHash: 'x', accessScope: 'global', roles: { create: { roleId: role.id } } } });
  const ctx = { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, userId: user.id, correlationId: randomUUID(), requestId: randomUUID() };
  auth.current = { userId: user.id, companyId: COMPANY_ID, branchIds: [], accessScope: 'global', isGlobal: false, ctx };
  manualAccount = (await db.chartOfAccount.create({ data: { companyId: COMPANY_ID, code: `adj-${randomUUID().slice(0, 6)}`, name: 'Adjustments',
    accountClass: 'equity', accountSubtype: 'equity', normalBalance: 'C', isActive: true, allowManualPosting: true } })).id;
}, 120_000);
afterAll(() => db.$disconnect());

const post = (amount: number) => POST(new NextRequest('http://local.test/api/v1/journal-entries', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `t-${randomUUID()}` },
  body: JSON.stringify({ entry_date: new Date().toISOString(), description: 'Correction', currency_code: 'BDT', exchange_rate: 1,
    lines: [{ chart_of_account_id: fx.expense.id, debit: amount, credit: 0 }, { chart_of_account_id: manualAccount, debit: 0, credit: amount }] }),
}));

describe('manual journal entries', () => {
  it('posts a second manual journal, not only the first', async () => {
    expect((await post(100)).status).toBe(201);
    expect((await post(200)).status).toBe(201);
  });

  it('refuses an adjustment above the threshold without approval rights', async () => {
    const res = await post(60_000);
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toMatch(/approval\.resolve/);
  });
});

describe('reconciliation: stuck refunds', () => {
  it('reports a gateway refund still pending after an hour', async () => {
    const { checkPendingRefunds } = await import('@/lib/reconciliation/checks');
    const ref = `PMT-STUCK-${randomUUID().slice(0, 6)}`;
    await db.payment.create({ data: { companyId: COMPANY_ID, branchId: fx.branches[0].id, referenceNo: ref, clientTxnId: randomUUID(),
      paymentType: 'sale_refund', direction: 'outgoing', financialAccountId: fx.cash.id, amount: 750, baseAmount: 750,
      paymentMethod: 'bkash', paymentStatus: 'pending', businessDate: new Date(), createdBy: fx.user.id,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    const findings = await checkPendingRefunds(db as never, COMPANY_ID);
    expect(findings).toHaveLength(1);
    expect(JSON.stringify(findings[0].details)).toContain(ref);
    await db.payment.deleteMany({ where: { companyId: COMPANY_ID, referenceNo: ref } });
  });
});
