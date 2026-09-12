import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
vi.mock('@/lib/numbering', () => ({ nextDocumentNumber: vi.fn(async () => ({ documentNumber: 'TEST-JOURNAL' })) }));
import { postJournalEntry, type PostJournalEntryInput } from '@/domain/commands/m4/PostJournalEntry';
import { postSale } from '@/domain/commands/m3/PostSale';

function fixture(period: unknown = { status: 'open' }) {
  const createLine = vi.fn(async () => ({}));
  const tx = {
    fiscalPeriod: { findFirst: vi.fn(async () => period) },
    chartOfAccount: { findMany: vi.fn(async () => [{ id: 'a', code: 'A', allowManualPosting: true }, { id: 'b', code: 'B', allowManualPosting: true }]) },
    businessEvent: { create: vi.fn(async () => ({})) },
    journalEntry: { create: vi.fn(async () => ({ id: 'entry' })) },
    journalLine: { create: createLine }, auditLog: { create: vi.fn(async () => ({})) },
  };
  const input: PostJournalEntryInput = {
    companyId: 'tenant-a', createdBy: 'user-a', entryDate: new Date('2026-09-12T00:00:00Z'),
    postingKind: 'manual_adjustment', sourceType: 'test', sourceId: 'fixture', description: 'Test',
    currencyCode: 'BDT', exchangeRate: 1,
    lines: [{ chartOfAccountId: 'a', debit: 1, credit: 0 }, { chartOfAccountId: 'b', debit: 0, credit: 1 }],
  };
  return { tx, input, client: tx as unknown as Prisma.TransactionClient };
}

describe('fail-closed financial posting', () => {
  for (const period of [null, { status: 'locked' }, { status: 'soft_locked' }, { status: 'unknown' }]) {
    it(`rejects period ${JSON.stringify(period)} before any journal writes`, async () => {
      const f = fixture(period);
      await expect(postJournalEntry(f.client, f.input, 'test')).rejects.toThrow(/open fiscal period/);
      expect(f.tx.journalEntry.create).not.toHaveBeenCalled();
    });
  }
  it('rejects a 0.005 imbalance, not rounding it away', async () => {
    const f = fixture(); f.input.lines[1].credit = '1.005';
    await expect(postJournalEntry(f.client, f.input, 'test')).rejects.toThrow(/Unbalanced/);
    expect(f.tx.journalEntry.create).not.toHaveBeenCalled();
  });
  it('adds decimal amounts exactly across 300 journal lines', async () => {
    const f = fixture();
    f.input.lines = Array.from({ length: 150 }, () => [
      { chartOfAccountId: 'a', debit: '0.1', credit: '0' },
      { chartOfAccountId: 'b', debit: '0', credit: '0.1' },
    ]).flat();
    const result = await postJournalEntry(f.client, f.input, 'test');
    expect(result.totalDebit).toBe('15.00'); expect(result.totalCredit).toBe('15.00');
    expect(f.tx.journalLine.create).toHaveBeenCalledTimes(300);
  });
  for (const amount of [NaN, Infinity, -1]) {
    it(`rejects invalid amount ${String(amount)}`, async () => {
      const f = fixture(); f.input.lines[0].debit = amount;
      await expect(postJournalEntry(f.client, f.input, 'test')).rejects.toThrow();
      expect(f.tx.journalEntry.create).not.toHaveBeenCalled();
    });
  }
  for (const tender of ['gift_card', 'store_credit']) {
    it(`rejects ${tender} before any persistence, including non-HTTP callers`, async () => {
      await expect(postSale({} as Prisma.TransactionClient, {
        companyId: 'tenant-a', branchId: 'branch-a', warehouseId: 'warehouse-a', cashierId: 'user-a',
        currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date(), items: [],
        payments: [{ paymentMethod: tender, amount: 100, financialAccountId: 'account' }],
      }, 'test')).rejects.toThrow(/unavailable until atomic redemption/);
    });
  }
});
