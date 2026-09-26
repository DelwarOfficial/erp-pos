// F-66 regression: the trial balance and the other ledger reports.
//
// The trial balance loaded every journal line into memory and summed with
// parseFloat; its is_balanced compared rounded totals with a 0.01 tolerance;
// and every ledger report counted only status 'posted', so a reversal was
// counted without its original. The report library additionally truncated at
// `take: 10000` and started party ledgers at zero on the `from` date.
//
// The report functions read through the global client, so the data is
// committed. Each run uses a fresh company id, which isolates it completely.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { computeTrialBalance, parseAsOf } from '@/lib/accounting/trialBalance';
import { postJournalEntry, reverseJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { reportBalanceSheet, reportCustomerLedger, reportProfitAndLoss, reportTrialBalance } from '@/reports';
import { runInTenantContext } from '@/lib/db/transaction';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const COMPANY_ID = randomUUID();
let userId: string;
let customerId: string;
let policy: { arAccountId: string; salesRevenueAccountId: string; inventoryAccountId: string; cogsAccountId: string };

const ctx = () => ({
  companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false,
  correlationId: randomUUID(), requestId: randomUUID(),
}) as never;

async function post(lines: Array<{ account: string; debit?: string; credit?: string; customerId?: string }>, date = new Date()) {
  return db.$transaction(tx => postJournalEntry(tx, {
    companyId: COMPANY_ID, entryDate: date, postingKind: 'manual_probe',
    sourceType: 'probe', sourceId: randomUUID(), description: 'Ledger report probe',
    currencyCode: 'BDT', exchangeRate: 1, createdBy: userId,
    lines: lines.map(line => ({
      chartOfAccountId: line.account, debit: line.debit ?? 0, credit: line.credit ?? 0, customerId: line.customerId,
    })),
  }, randomUUID()));
}

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318'
    || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  const fixture = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'LR', code: `SYN-LR-${COMPANY_ID.slice(0, 8)}` });
  userId = fixture.user.id;
  policy = await db.accountingPolicy.findUniqueOrThrow({ where: { companyId: COMPANY_ID } });
  customerId = (await db.customer.create({ data: { companyId: COMPANY_ID, name: 'Ledger probe customer' } })).id;

  // Ten sales of 0.10: exact in Decimal, not exact in binary floating point.
  for (let i = 0; i < 10; i++) {
    await post([
      { account: policy.arAccountId, debit: '0.10', customerId },
      { account: policy.salesRevenueAccountId, credit: '0.10' },
    ]);
  }
  // One sale of 500, then reversed: a void. Net effect on every account: zero.
  const voided = await post([
    { account: policy.arAccountId, debit: '500.00', customerId },
    { account: policy.salesRevenueAccountId, credit: '500.00' },
  ]);
  await db.$transaction(tx => reverseJournalEntry(tx, {
    journalEntryId: voided.journalEntryId, companyId: COMPANY_ID, reversedBy: userId, reason: 'probe void',
  }, randomUUID()));
});

afterAll(() => db.$disconnect());

describe('trial balance', () => {
  it('counts a reversed original together with its reversal', async () => {
    const report = await runInTenantContext(ctx(), () => computeTrialBalance(db, COMPANY_ID, new Date()));
    const revenue = report.accounts.find(row => row.account_id === policy.salesRevenueAccountId)!;

    // 10 × 0.10 = 1.00. The void nets to zero. Counting only 'posted' took the
    // reversal (Dr revenue 500) without its original, and showed revenue as a
    // 499.00 debit.
    expect(revenue.balance).toBe('1.00');
    expect(revenue.balance_type).toBe('Credit');
  });

  it('sums exactly and reports balance by exact equality', async () => {
    const report = await runInTenantContext(ctx(), () => computeTrialBalance(db, COMPANY_ID, new Date()));
    const receivable = report.accounts.find(row => row.account_id === policy.arAccountId)!;
    expect(receivable.balance).toBe('1.00');
    expect(report.summary.difference).toBe('0.00');
    expect(report.summary.is_balanced).toBe(true);
    expect(report.summary.total_debit).toBe(report.summary.total_credit);
  });

  it('treats a bare date as the whole of that day', () => {
    expect(parseAsOf('2026-09-30').toISOString()).toBe('2026-09-30T23:59:59.999Z');
  });

  it('rejects an unparseable date instead of passing it to the database', () => {
    expect(() => parseAsOf('not-a-date')).toThrow(/as_of/);
  });

  it('is the same computation behind the report library', async () => {
    const api = await runInTenantContext(ctx(), () => computeTrialBalance(db, COMPANY_ID, new Date()));
    const library = await runInTenantContext(ctx(), () => reportTrialBalance(COMPANY_ID));
    expect(library.summary).toMatchObject({ is_balanced: api.summary.is_balanced, total_debit: api.summary.total_debit });
  });
});

describe('profit and loss', () => {
  it('does not turn a voided sale into negative revenue', async () => {
    const report = await runInTenantContext(ctx(), () => reportProfitAndLoss(COMPANY_ID));
    expect(report.summary!.total_revenue).toBe('1.00');
  });
});

describe('balance sheet', () => {
  it('balances once unclosed earnings are carried in equity', async () => {
    const report = await runInTenantContext(ctx(), () => reportBalanceSheet(COMPANY_ID));
    expect(report.summary).toMatchObject({ current_period_earnings: '1.00', is_balanced: true });
  });
});

describe('customer ledger', () => {
  it('opens with the balance brought forward rather than zero', async () => {
    // Everything so far is before this window, so it all arrives as opening balance.
    const from = new Date(Date.now() + 1000);
    await post([
      { account: policy.arAccountId, debit: '5.00', customerId },
      { account: policy.salesRevenueAccountId, credit: '5.00' },
    ], new Date(Date.now() + 2000));

    const report = await runInTenantContext(ctx(), () =>
      reportCustomerLedger(COMPANY_ID, { customerId, fromDate: from, toDate: new Date(Date.now() + 60_000) }));

    // Before the fix the running balance started at 0.00 and closed at 5.00.
    expect(report.summary).toMatchObject({ opening_balance: '1.00', closing_balance: '6.00' });
  });
});
