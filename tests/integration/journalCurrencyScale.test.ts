// F-31 / F-32: journal lines are stored to the paisa and stay balanced; an
// exchange rate given as a string is kept exact. Disposable MariaDB.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { withTenant } from '@/lib/db/transaction';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const A: string = randomUUID();
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let accounts: { a: string; b: string; c: string; rounding: string };
const ctx = () => ({ companyId: A, branchIds: [], allBranches: true, isGlobal: false, userId: undefined, correlationId: randomUUID(), requestId: randomUUID() }) as never;
const post = (lines: Array<{ chartOfAccountId: string; debit: string; credit: string }>, exchangeRate: number | string = 1) =>
  withTenant(ctx(), tx => postJournalEntry(tx, { companyId: A, entryDate: new Date(), postingKind: 'test', sourceType: 'test', sourceId: randomUUID(),
    description: 'scale', currencyCode: 'BDT', exchangeRate, createdBy: fx.user.id, lines }, randomUUID()));
const stored = async (entryId: string) => (await db.journalLine.findMany({ where: { journalEntryId: entryId }, orderBy: { lineNo: 'asc' } }))
  .map(l => [l.chartOfAccountId, new Prisma.Decimal(l.debitBase).toFixed(), new Prisma.Decimal(l.creditBase).toFixed()]);

beforeAll(async () => {
  fx = await ensureSyntheticIssuerTenant(db, { companyId: A, label: 'JS', code: `SYN-JS-${A.slice(0, 8)}` });
  const make = async (code: string) => (await db.chartOfAccount.create({ data: { companyId: A, code, name: code, accountClass: 'expense', accountSubtype: 'operating_expense', normalBalance: 'D' } })).id;
  accounts = { a: await make('JS-A'), b: await make('JS-B'), c: await make('JS-C'), rounding: await make('JS-R') };
}, 120_000);
afterAll(() => db.$disconnect());

describe('journal currency scale', () => {
  it('rounds each line to the paisa when the entry still balances', async () => {
    const entry = await post([{ chartOfAccountId: accounts.a, debit: '99.9999', credit: '0' }, { chartOfAccountId: accounts.b, debit: '0', credit: '99.9999' }]);
    expect(await stored(entry.journalEntryId)).toEqual([[accounts.a, '100', '0'], [accounts.b, '0', '100']]);
  });

  it('puts the paisa rounding creates on the rounding account', async () => {
    await db.accountingPolicy.update({ where: { companyId: A }, data: { roundingAccountId: accounts.rounding } });
    // 10.005 + 10.005 = 20.01 either side; each rounds up to 10.01, so debits are 20.02.
    const entry = await post([
      { chartOfAccountId: accounts.a, debit: '10.005', credit: '0' }, { chartOfAccountId: accounts.b, debit: '10.005', credit: '0' },
      { chartOfAccountId: accounts.c, debit: '0', credit: '20.01' },
    ]);
    expect(await stored(entry.journalEntryId)).toEqual([
      [accounts.a, '10.01', '0'], [accounts.b, '10.01', '0'], [accounts.c, '0', '20.01'], [accounts.rounding, '0', '0.01'],
    ]);
  });

  it('without a rounding account, adjusts the largest line of the short side', async () => {
    await db.accountingPolicy.update({ where: { companyId: A }, data: { roundingAccountId: null } });
    const entry = await post([
      { chartOfAccountId: accounts.a, debit: '10.005', credit: '0' }, { chartOfAccountId: accounts.b, debit: '10.005', credit: '0' },
      { chartOfAccountId: accounts.c, debit: '0', credit: '20.01' },
    ]);
    expect(await stored(entry.journalEntryId)).toEqual([[accounts.a, '10.01', '0'], [accounts.b, '10.01', '0'], [accounts.c, '0', '20.02']]);
  });

  it('keeps a string exchange rate exact, and refuses an entry below one paisa', async () => {
    const entry = await post([{ chartOfAccountId: accounts.a, debit: '5', credit: '0' }, { chartOfAccountId: accounts.b, debit: '0', credit: '5' }], '117.123456');
    expect(new Prisma.Decimal((await db.journalEntry.findUniqueOrThrow({ where: { id: entry.journalEntryId } })).exchangeRate).toFixed()).toBe('117.123456');
    await expect(post([{ chartOfAccountId: accounts.a, debit: '0.001', credit: '0' }, { chartOfAccountId: accounts.b, debit: '0', credit: '0.001' }]))
      .rejects.toThrow(/smallest currency unit/);
  });
});
