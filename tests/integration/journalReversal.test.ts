// Reversing a journal entry (disposable MariaDB, rolled back):
//   - while its period is open, the reversal is dated with the original;
//   - once its period is locked, the reversal posts today in the open period,
//     and the locked period is not touched;
//   - an entry cannot be reversed twice.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postJournalEntry, reverseJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';
import { runInTenantContext } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = 'e193a4b5-c6d7-4e23-b456-708192a3b4c5';
const ROLLBACK = new Error('ROLLBACK_REVERSAL');
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'JR', code: 'SYN-JR' });
}, 120_000);
afterAll(() => db.$disconnect());

async function probe(body: (tx: Prisma.TransactionClient) => Promise<void>) {
  const ctx = { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, correlationId: randomUUID(), requestId: randomUUID() } as never;
  try { await runInTenantContext(ctx, () => db.$transaction(async tx => { await body(tx); throw ROLLBACK; }, { timeout: 60_000 })); }
  catch (error) { if (error !== ROLLBACK) throw error; }
}

const manual = (tx: Prisma.TransactionClient, entryDate: Date) => postJournalEntry(tx, {
  companyId: COMPANY_ID, entryDate, postingKind: 'test_adjustment', sourceType: 'test', sourceId: randomUUID(),
  description: 'Correction', currencyCode: 'BDT', exchangeRate: 1, createdBy: fx.user.id,
  lines: [{ chartOfAccountId: fx.expense.id, debit: 500, credit: 0 }, { chartOfAccountId: fx.cash.chartOfAccountId, debit: 0, credit: 500 }],
}, randomUUID());

describe('reversing a journal entry', () => {
  it('keeps the original date while its period is open, and refuses a second reversal', async () => {
    await probe(async tx => {
      const original = await manual(tx, new Date());
      const rev = await reverseJournalEntry(tx, { journalEntryId: original.journalEntryId, companyId: COMPANY_ID, reversedBy: fx.user.id, reason: 'typo' }, randomUUID());
      const [a, b] = await Promise.all([original.journalEntryId, rev.journalEntryId].map(id => tx.journalEntry.findUniqueOrThrow({ where: { id } })));
      expect(b.entryDate.toISOString().slice(0, 10)).toBe(a.entryDate.toISOString().slice(0, 10));
      await expect(reverseJournalEntry(tx, { journalEntryId: original.journalEntryId, companyId: COMPANY_ID, reversedBy: fx.user.id, reason: 'again' }, randomUUID())).rejects.toThrow(/already reversed/);
    });
  });

  it('posts today when the original period has been locked', async () => {
    await probe(async tx => {
      const old = await tx.fiscalPeriod.create({ data: { companyId: COMPANY_ID, periodName: `Old-${randomUUID().slice(0, 6)}`,
        periodStart: new Date('2001-03-01'), periodEnd: new Date('2001-03-31'), status: 'open' } });
      const original = await manual(tx, new Date('2001-03-15T00:00:00Z'));
      await tx.fiscalPeriod.update({ where: { id: old.id }, data: { status: 'locked' } });
      const rev = await reverseJournalEntry(tx, { journalEntryId: original.journalEntryId, companyId: COMPANY_ID, reversedBy: fx.user.id, reason: 'found after close' }, randomUUID());
      const entry = await tx.journalEntry.findUniqueOrThrow({ where: { id: rev.journalEntryId } });
      expect(entry.entryDate.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
      expect((await tx.journalEntry.findUniqueOrThrow({ where: { id: original.journalEntryId } })).status).toBe('reversed');
    });
  });
});

describe('the period an entry posts to', () => {
  it("uses the company's local day: 01:00 in Dhaka on the 1st is the new month", async () => {
    await probe(async tx => {
      const mk = (name: string, start: string, end: string, status: string) => tx.fiscalPeriod.create({ data: { companyId: COMPANY_ID,
        periodName: `${name}-${randomUUID().slice(0, 6)}`, periodStart: new Date(`${start}T00:00:00Z`), periodEnd: new Date(`${end}T23:59:59.999Z`), status } });
      await mk('Jan', '2002-01-01', '2002-01-31', 'locked');
      await mk('Feb', '2002-02-01', '2002-02-28', 'open');
      // 2002-01-31T19:00Z is 2002-02-01 01:00 in Asia/Dhaka (UTC+6).
      await expect(manual(tx, new Date('2002-01-31T19:00:00Z'))).resolves.toMatchObject({ status: 'posted' });
      // 2002-01-31T17:00Z is still 23:00 on the 31st in Dhaka: the locked period.
      await expect(manual(tx, new Date('2002-01-31T17:00:00Z'))).rejects.toThrow(/open fiscal period/);
    });
  });
});
