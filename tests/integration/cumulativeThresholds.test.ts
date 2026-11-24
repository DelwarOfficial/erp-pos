// Red-team workstream 7: approval thresholds must not be splittable.
// One user's same-type operations over 24 hours add up; once the running
// total crosses the threshold the approval rule applies. Other users'
// operations never count toward someone's total. Disposable MariaDB; only
// the session is stubbed.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const auth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/auth/middleware', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth/middleware')>()),
  authenticateRequest: async () => auth.current,
}));
import { POST as postJournal } from '@/app/api/v1/journal-entries/route';
import { postExpense } from '@/domain/commands/m4/PostExpense';
import { checkCumulativeThreshold } from '@/lib/approval/cumulative';
import { withTenant } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = 'c7a0b1d2-6e77-4c93-9f85-b02c3d4e5f67';
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let roleId: string;
let categoryId: string;
let debitAccount: string;
let creditAccount: string;
const ctx = (userId?: string) => ({ companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, userId, correlationId: randomUUID(), requestId: randomUUID() }) as never;

async function newUser() {
  const id = (await db.user.create({ data: { companyId: COMPANY_ID, name: 'Poster', email: `${randomUUID()}@example.invalid`, passwordHash: 'x', accessScope: 'global',
    roles: { create: { roleId } } } })).id;
  return id;
}
function as(userId: string) {
  auth.current = { userId, companyId: COMPANY_ID, branchIds: [], accessScope: 'global', isGlobal: false, ctx: ctx(userId) };
}
const journal = (amount: number) => postJournal(new NextRequest('http://local.test/api/v1/journal-entries', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `t-${randomUUID()}` },
  body: JSON.stringify({ entry_date: new Date().toISOString(), description: 'probe', lines: [
    { chart_of_account_id: debitAccount, debit: amount, credit: 0 },
    { chart_of_account_id: creditAccount, debit: 0, credit: amount },
  ] }) }));
const expense = (userId: string, amount: number) => withTenant(ctx(userId), t => postExpense(t, {
  companyId: COMPANY_ID, branchId: fx.branches[0].id, expenseDate: new Date(), currencyCode: 'BDT', exchangeRate: 1,
  description: 'probe', financialAccountId: fx.cash.id, items: [{ expenseCategoryId: categoryId, amount, taxAmount: 0 }], createdBy: userId,
}, randomUUID()));

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'CT', code: 'SYN-CT' });
  // journal.post without approval.resolve: a poster who cannot approve.
  const perms = await db.permission.findMany({ where: { code: { in: ['journal.post'] } } });
  expect(perms).toHaveLength(1);
  roleId = (await db.role.create({ data: { companyId: COMPANY_ID, name: `poster-${randomUUID().slice(0, 6)}`, permissions: { create: perms.map(p => ({ permissionId: p.id })) } } })).id;
  const manualAccount = async (cls: string, nb: string) => (await db.chartOfAccount.findFirst({ where: { companyId: COMPANY_ID, code: 'ct-' + cls } })
    ?? await db.chartOfAccount.create({ data: { companyId: COMPANY_ID, code: 'ct-' + cls, name: 'CT ' + cls, accountClass: cls, accountSubtype: cls === 'expense' ? 'operating_expense' : 'current_liability', normalBalance: nb, allowManualPosting: true } })).id;
  debitAccount = await manualAccount('expense', 'D');
  creditAccount = await manualAccount('liability', 'C');
  categoryId = (await db.expenseCategory.create({ data: { companyId: COMPANY_ID, name: `CT-${randomUUID().slice(0, 6)}`, expenseAccountId: fx.expense.id } })).id;
}, 120_000);
afterAll(() => db.$disconnect());

describe('manual journals (threshold 50,000)', () => {
  it('ten 49,999 journals by one user: the second one crosses and needs an approver', async () => {
    as(await newUser());
    const statuses: number[] = [];
    let crossing: { code?: string; details?: Record<string, unknown> } | undefined;
    for (let i = 0; i < 10; i++) {
      const res = await journal(49_999);
      statuses.push(res.status);
      if (res.status === 403 && !crossing) crossing = ((await res.json()) as { error: typeof crossing }).error;
    }
    expect(statuses).toEqual([201, 403, 403, 403, 403, 403, 403, 403, 403, 403]);
    expect(crossing).toMatchObject({ code: 'APPROVAL_REQUIRED', details: { cumulative_base: '99998.00', threshold: 50000 } });
  }, 120_000);

  it('the same amounts spread across ten users do not trigger it', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      as(await newUser());
      statuses.push((await journal(49_999)).status);
    }
    expect(statuses).toEqual(Array(10).fill(201));
  }, 120_000);

  it('below the threshold, single journals behave as before', async () => {
    as(await newUser());
    expect((await journal(20_000)).status).toBe(201);
    expect((await journal(30_000)).status).toBe(201); // exactly 50,000: not above
  });
});

describe('expenses (threshold 10,000)', () => {
  it('the crossing expense waits for approval and the audit row records the running total', async () => {
    const userId = await newUser();
    expect((await expense(userId, 6_000)).status).toBe('posted');
    const second = await expense(userId, 6_000);
    expect(second.status).toBe('pending_approval');
    const row = await db.auditLog.findFirstOrThrow({ where: { companyId: COMPANY_ID, action: 'expense.submit', entityId: second.expenseId } });
    expect(JSON.parse(row.afterValue!)).toMatchObject({ cumulative_base: '12000.00', threshold: 10000, cumulative_trigger: true });
  });

  it('another user\'s expenses do not count', async () => {
    const a = await newUser();
    const b = await newUser();
    expect((await expense(a, 6_000)).status).toBe('posted');
    expect((await expense(b, 6_000)).status).toBe('posted');
  });
});

describe('gateway refunds (threshold 5,000)', () => {
  const refundRow = (userId: string, amount: number, status = 'posted') => db.payment.create({ data: { companyId: COMPANY_ID, branchId: fx.branches[0].id,
    referenceNo: `REFUND-${randomUUID().slice(0, 8)}`, clientTxnId: randomUUID(), paymentType: 'sale_refund', direction: 'outgoing',
    financialAccountId: fx.cash.id, amount, baseAmount: amount, paymentMethod: 'bkash', paymentStatus: status, businessDate: new Date(), createdBy: userId } });
  const check = (userId: string, amount: number) => withTenant(ctx(userId), t =>
    checkCumulativeThreshold(t, 'refund', { companyId: COMPANY_ID, userId, amountBase: new Prisma.Decimal(amount), threshold: 5000 }));

  it('counts the refunder\'s own refunds, pending ones included, but not failed ones or other users\'', async () => {
    const a = await newUser();
    const b = await newUser();
    await refundRow(a, 3_000, 'pending');
    await refundRow(a, 9_000, 'failed');
    await refundRow(b, 4_000);
    expect(await check(a, 1_999)).toMatchObject({ required: false, cumulative: '4999.00' });
    expect(await check(a, 2_001)).toMatchObject({ required: true, single: false, cumulative: '5001.00' });
    expect(await check(b, 1_000)).toMatchObject({ required: false });
  });
});
