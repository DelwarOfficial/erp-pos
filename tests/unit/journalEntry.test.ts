// tests/unit/journalEntry.test.ts
// Tests for postJournalEntry — double-entry integrity.
//
// Scenarios:
//   1. Balanced journal posts successfully
//   2. Unbalanced journal rejected
//   3. Reversal creates equal-and-opposite entry
//   4. Both debit+credit on same line rejected
//   5. Empty journal (zero debit/credit) rejected

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { postJournalEntry, reverseJournalEntry } from '../../src/domain/commands/m4/PostJournalEntry';
import { DomainError } from '../../src/lib/errors/codes';

const db = new PrismaClient();

let companyId: string;
let userId: string;
let cashAccountId: string;
let revenueAccountId: string;
let expenseAccountId: string;

beforeAll(async () => {
  await db.$connect();
  const company = await db.company.create({
    data: {
      code: 'TEST-JE-' + Date.now(),
      legalName: 'Journal Test Co',
      displayName: 'JE Test',
      baseCurrencyCode: 'BDT',
      status: 'active',
    },
  });
  companyId = company.id;
  const user = await db.user.create({
    data: { companyId, name: 'Accountant', email: 'je-' + Date.now() + '@test.local', passwordHash: 'x', accessScope: 'global' },
  });
  userId = user.id;

  // Create chart of accounts
  const cash = await db.chartOfAccount.create({
    data: { companyId, code: '1001', name: 'Cash', accountClass: 'asset', accountSubtype: 'current_asset', normalBalance: 'D', allowManualPosting: true },
  });
  cashAccountId = cash.id;
  const revenue = await db.chartOfAccount.create({
    data: { companyId, code: '4001', name: 'Sales Revenue', accountClass: 'revenue', accountSubtype: 'operating_revenue', normalBalance: 'C', allowManualPosting: true },
  });
  revenueAccountId = revenue.id;
  const expense = await db.chartOfAccount.create({
    data: { companyId, code: '5001', name: 'Office Expense', accountClass: 'expense', accountSubtype: 'operating_expense', normalBalance: 'D', allowManualPosting: true },
  });
  expenseAccountId = expense.id;
});

afterAll(async () => {
  if (companyId) {
    try {
      await db.journalLine.deleteMany({ where: { companyId } });
      await db.journalEntry.deleteMany({ where: { companyId } });
      await db.businessEvent.deleteMany({ where: { companyId } });
      await db.chartOfAccount.deleteMany({ where: { companyId } });
      await db.user.deleteMany({ where: { companyId } });
      await db.auditLog.deleteMany({ where: { companyId } });
      await db.company.deleteMany({ where: { id: companyId } });
    } catch (e) { console.error('Cleanup (non-fatal):', e); }
  }
  await db.$disconnect();
});

describe('postJournalEntry — double-entry integrity', () => {
  it('posts a balanced journal entry (Dr Cash 1000, Cr Revenue 1000)', async () => {
    const result = await db.$transaction(async (tx) => {
      return postJournalEntry(tx, {
        companyId, entryDate: new Date(),
        postingKind: 'manual_adjustment',
        sourceType: 'test', sourceId: 'test-1',
        description: 'Test sale entry',
        currencyCode: 'BDT', exchangeRate: 1,
        createdBy: userId,
        lines: [
          { chartOfAccountId: cashAccountId, debit: 1000, credit: 0 },
          { chartOfAccountId: revenueAccountId, debit: 0, credit: 1000 },
        ],
      }, 'test-corr-1');
    });

    expect(result.status).toBe('posted');
    expect(result.totalDebit).toBe('1000.00');
    expect(result.totalCredit).toBe('1000.00');
  });

  it('rejects unbalanced entry (Dr 1000, Cr 500)', async () => {
    await expect(
      db.$transaction(async (tx) => {
        return postJournalEntry(tx, {
          companyId, entryDate: new Date(),
          postingKind: 'manual_adjustment',
          sourceType: 'test', sourceId: 'test-2',
          description: 'Unbalanced',
          currencyCode: 'BDT', exchangeRate: 1,
          createdBy: userId,
          lines: [
            { chartOfAccountId: cashAccountId, debit: 1000, credit: 0 },
            { chartOfAccountId: revenueAccountId, debit: 0, credit: 500 },
          ],
        }, 'test-corr-2');
      }),
    ).rejects.toThrow(/Unbalanced/);
  });

  it('rejects line with both debit and credit > 0', async () => {
    await expect(
      db.$transaction(async (tx) => {
        return postJournalEntry(tx, {
          companyId, entryDate: new Date(),
          postingKind: 'manual_adjustment',
          sourceType: 'test', sourceId: 'test-3',
          description: 'Both Dr+Cr',
          currencyCode: 'BDT', exchangeRate: 1,
          createdBy: userId,
          lines: [
            { chartOfAccountId: cashAccountId, debit: 100, credit: 100 },
            { chartOfAccountId: revenueAccountId, debit: 0, credit: 100 },
          ],
        }, 'test-corr-3');
      }),
    ).rejects.toThrow(/cannot have both debit and credit/);
  });

  it('rejects empty journal (all zeros)', async () => {
    await expect(
      db.$transaction(async (tx) => {
        return postJournalEntry(tx, {
          companyId, entryDate: new Date(),
          postingKind: 'manual_adjustment',
          sourceType: 'test', sourceId: 'test-4',
          description: 'Empty',
          currencyCode: 'BDT', exchangeRate: 1,
          createdBy: userId,
          lines: [
            { chartOfAccountId: cashAccountId, debit: 0, credit: 0 },
            { chartOfAccountId: revenueAccountId, debit: 0, credit: 0 },
          ],
        }, 'test-corr-4');
      }),
    ).rejects.toThrow(/must have either debit or credit/);
  });

  it('reversal creates equal-and-opposite entry', async () => {
    // Post an entry
    const original = await db.$transaction(async (tx) => {
      return postJournalEntry(tx, {
        companyId, entryDate: new Date(),
        postingKind: 'manual_adjustment',
        sourceType: 'test', sourceId: 'test-5',
        description: 'To be reversed',
        currencyCode: 'BDT', exchangeRate: 1,
        createdBy: userId,
        lines: [
          { chartOfAccountId: cashAccountId, debit: 500, credit: 0 },
          { chartOfAccountId: revenueAccountId, debit: 0, credit: 500 },
        ],
      }, 'test-corr-5');
    });

    // Reverse it
    const reversal = await db.$transaction(async (tx) => {
      return reverseJournalEntry(tx, {
        journalEntryId: original.journalEntryId,
        companyId,
        reversedBy: userId,
        reason: 'test reversal',
      }, 'test-corr-rev');
    });

    expect(reversal.status).toBe('posted');
    expect(reversal.totalDebit).toBe('500.00');
    expect(reversal.totalCredit).toBe('500.00');

    // Verify original is marked 'reversed'
    const orig = await db.journalEntry.findUnique({ where: { id: original.journalEntryId } });
    expect(orig?.status).toBe('reversed');

    // Verify the reversal lines are swapped (Cr Cash, Dr Revenue)
    const revLines = await db.journalLine.findMany({
      where: { journalEntryId: reversal.journalEntryId },
      orderBy: { lineNo: 'asc' },
    });
    expect(parseFloat(revLines[0].creditBase.toString())).toBe(500);  // Cash was Dr, now Cr
    expect(parseFloat(revLines[0].debitBase.toString())).toBe(0);
    expect(parseFloat(revLines[1].debitBase.toString())).toBe(500);   // Revenue was Cr, now Dr
    expect(parseFloat(revLines[1].creditBase.toString())).toBe(0);
  });

  it('rejects reversal of already-reversed entry', async () => {
    // The entry from the previous test was already reversed
    const entries = await db.journalEntry.findMany({
      where: { companyId, status: 'reversed' },
      orderBy: { createdAt: 'asc' },
    });
    if (entries.length > 0) {
      await expect(
        db.$transaction(async (tx) => {
          return reverseJournalEntry(tx, {
            journalEntryId: entries[0].id,
            companyId,
            reversedBy: userId,
            reason: 'double reversal',
          }, 'test-corr-dbl');
        }),
      ).rejects.toThrow(/already reversed/);
    }
  });
});
