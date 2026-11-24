// Red-team regressions for two commands that could not post a balanced entry:
// taxed expenses (debit left the tax out, credit included it) and courier COD
// settlements (the adjustment was on the wrong side, and a zero fee produced
// a zero-amount line the journal rejects).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const mocks = vi.hoisted(() => ({ journal: vi.fn(), number: vi.fn() }));
vi.mock('@/domain/commands/m4/PostJournalEntry', () => ({ postJournalEntry: mocks.journal }));
vi.mock('@/lib/numbering', () => ({ nextDocumentNumber: mocks.number }));

import { postExpense } from '@/domain/commands/m4/PostExpense';
import { postCourierCodSettlement } from '@/domain/commands/m5/PostCourierCodSettlement';

type Line = { debit: Prisma.Decimal.Value; credit: Prisma.Decimal.Value };
function totals() {
  const lines: Line[] = mocks.journal.mock.calls[0][1].lines;
  const sum = (side: 'debit' | 'credit') =>
    lines.reduce((acc, line) => acc.plus(line[side]), new Prisma.Decimal(0));
  for (const line of lines) {
    // The journal rejects a line with neither side set.
    expect(new Prisma.Decimal(line.debit).plus(line.credit).gt(0)).toBe(true);
  }
  return { debit: sum('debit'), credit: sum('credit') };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.journal.mockResolvedValue({ journalEntryId: 'je-1', entryNo: 'JE-1' });
  mocks.number.mockResolvedValue({ documentNumber: 'DOC-1' });
});

describe('postExpense', () => {
  const tx = {
    expense: { aggregate: vi.fn(async () => ({ _sum: { baseGrandTotal: null } })), create: vi.fn(async () => ({ id: 'exp-1' })), update: vi.fn() },
    expenseItem: { create: vi.fn() },
    expenseCategory: { findMany: vi.fn(async () => [{ id: 'cat-1', expenseAccountId: 'coa-exp' }]) },
    financialAccount: { findFirst: vi.fn(async () => ({ chartOfAccountId: 'coa-cash' })) },
    auditLog: { create: vi.fn() },
  } as unknown as Prisma.TransactionClient;
  const input = (items: Array<{ amount: number; taxAmount: number }>, exchangeRate = 1) => ({
    companyId: 'company-a', branchId: 'branch-a', expenseDate: new Date('2026-09-01'),
    currencyCode: 'BDT', exchangeRate, description: 'Office', financialAccountId: 'fa-1', createdBy: 'user-a',
    items: items.map(item => ({ expenseCategoryId: 'cat-1', ...item })),
  });

  it('balances an expense that carries tax', async () => {
    await postExpense(tx, input([{ amount: 1000, taxAmount: 150 }]), 'corr');
    const { debit, credit } = totals();
    expect(debit.toFixed(2)).toBe('1150.00');
    expect(credit.eq(debit)).toBe(true);
  });

  it('balances a multi-line foreign-currency expense to the cent', async () => {
    await postExpense(tx, input([
      { amount: 0.1, taxAmount: 0.02 }, { amount: 0.2, taxAmount: 0.01 }, { amount: 33.33, taxAmount: 4.99 },
    ], 123.456789), 'corr');
    const { debit, credit } = totals();
    expect(credit.eq(debit)).toBe(true);
    expect(debit.decimalPlaces()).toBeLessThanOrEqual(2);
  });
});

describe('postCourierCodSettlement', () => {
  const order = (id: string, over: Record<string, unknown> = {}) => ({
    id, referenceNo: `DO-${id}`, status: 'delivered', deliveryMethod: 'courier', courierCode: 'pathao',
    codAmount: new Prisma.Decimal(1000), codSettlementItems: [], ...over,
  });
  const orders = vi.fn();
  const tx = {
    accountingPolicy: { findUnique: vi.fn(async () => ({ courierClearingAccountId: 'coa-clearing' })) },
    deliveryOrder: { findMany: orders },
    courierCodSettlement: { create: vi.fn(async () => ({ id: 'cs-1' })), update: vi.fn() },
    courierCodSettlementItem: { create: vi.fn() },
    financialAccount: { findFirst: vi.fn(async () => ({ chartOfAccountId: 'coa-cash' })) },
    chartOfAccount: { findFirst: vi.fn(async () => ({ id: 'coa-courier-fee' })) },
    businessEvent: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  } as unknown as Prisma.TransactionClient;
  const settle = (items: Array<{ deliveryOrderId: string; codAmount: number; feeAmount: number; adjustmentAmount: number }>) =>
    postCourierCodSettlement(tx, {
      companyId: 'company-a', branchId: 'branch-a', courierCode: 'pathao', settlementDate: new Date('2026-09-01'),
      financialAccountId: 'fa-1', postedBy: 'user-a', items,
    }, 'corr');

  beforeEach(() => orders.mockResolvedValue([order('a')]));

  it.each([
    { fee: 60, adjustment: 0 },
    { fee: 60, adjustment: 25 },
    { fee: 60, adjustment: -25 },
    { fee: 0, adjustment: 0 },
  ])('posts a balanced entry for %j', async ({ fee, adjustment }) => {
    await settle([{ deliveryOrderId: 'a', codAmount: 1000, feeAmount: fee, adjustmentAmount: adjustment }]);
    const { debit, credit } = totals();
    expect(credit.eq(debit)).toBe(true);
    const cash = mocks.journal.mock.calls[0][1].lines.find((l: { chartOfAccountId: string }) => l.chartOfAccountId === 'coa-cash');
    expect(new Prisma.Decimal(cash.debit).toNumber()).toBe(1000 - fee + adjustment);
    // The clearing account is cleared by exactly the COD collected; the fee and
    // any adjustment land on the courier fee expense account.
    const lines = mocks.journal.mock.calls[0][1].lines as Array<{ chartOfAccountId: string; debit: Prisma.Decimal.Value; credit: Prisma.Decimal.Value }>;
    const net = (id: string) => lines.filter(l => l.chartOfAccountId === id).reduce((t, l) => t.plus(l.debit).minus(l.credit), new Prisma.Decimal(0)).toNumber();
    expect(net('coa-clearing')).toBe(-1000);
    expect(net('coa-courier-fee')).toBe(fee - adjustment);
  });

  it.each([
    ['an order of another company', []],
    ['an order shipped with another courier', [order('a', { courierCode: 'redx' })]],
    ['an undelivered order', [order('a', { status: 'in_transit' })]],
    ['an order already settled', [order('a', { codSettlementItems: [{ settlementId: 'cs-0' }] })]],
    ['more COD than the order carries', [order('a', { codAmount: new Prisma.Decimal(500) })]],
  ])('refuses %s', async (_name, found) => {
    orders.mockResolvedValue(found);
    await expect(settle([{ deliveryOrderId: 'a', codAmount: 1000, feeAmount: 0, adjustmentAmount: 0 }])).rejects.toThrow();
    expect(mocks.journal).not.toHaveBeenCalled();
  });

  it('refuses the same order twice in one batch', async () => {
    const item = { deliveryOrderId: 'a', codAmount: 100, feeAmount: 0, adjustmentAmount: 0 };
    await expect(settle([item, item])).rejects.toThrow();
    expect(mocks.journal).not.toHaveBeenCalled();
  });
});
