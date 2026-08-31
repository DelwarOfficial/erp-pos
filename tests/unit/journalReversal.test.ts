import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/numbering', () => ({
  nextDocumentNumber: vi.fn().mockResolvedValue({ documentNumber: 'JE-000001' }),
}));

import { reverseJournalEntry } from '@/domain/commands/m4/PostJournalEntry';

describe('journal reversal immutability', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the reversal link during insert and only updates the original status', async () => {
    const journalEntryCreate = vi.fn().mockResolvedValue({ id: 'reversal-id' });
    const journalEntryUpdate = vi.fn().mockResolvedValue({});
    const tx = {
      journalEntry: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({
            id: 'original-id',
            companyId: 'company-a',
            status: 'posted',
            entryNo: 'JE-000000',
            entryDate: new Date('2026-08-31T00:00:00Z'),
            postingKind: 'manual_adjustment',
            currencyCode: 'BDT',
            exchangeRate: { toString: () => '1' },
            lines: [
              { chartOfAccountId: 'coa-debit', debitBase: 100, creditBase: 0, memo: null },
              { chartOfAccountId: 'coa-credit', debitBase: 0, creditBase: 100, memo: null },
            ],
          })
          .mockResolvedValueOnce(null),
        create: journalEntryCreate,
        update: journalEntryUpdate,
      },
      fiscalPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
      chartOfAccount: {
        findFirst: vi.fn().mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve({ code: where.id, allowManualPosting: true })),
      },
      businessEvent: { create: vi.fn().mockResolvedValue({}) },
      journalLine: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    await reverseJournalEntry(tx as never, {
      journalEntryId: 'original-id',
      companyId: 'company-a',
      reversedBy: 'user-a',
      reason: 'correction',
    }, 'correlation-a');

    expect(journalEntryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reversalOfEntryId: 'original-id', status: 'posted' }),
    }));
    expect(journalEntryUpdate).toHaveBeenCalledTimes(1);
    expect(journalEntryUpdate).toHaveBeenCalledWith({
      where: { id: 'original-id' },
      data: { status: 'reversed' },
    });
  });
});
