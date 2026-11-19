// Multi-currency revaluation (disposable MariaDB, rolled back):
//   a USD bank account holding 100 USD booked at 110 (11,000) is revalued:
//   - at 115: +500 gain, Dr bank / Cr exchange gain/loss;
//   - again at 115: nothing to post (earlier revaluations are book value);
//   - at 112: −300, back down, as a loss.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { runRevaluation } from '@/lib/accounting/revaluation';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';
import { runInTenantContext } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = 'a3b5c6d7-e8f9-4a45-d678-92a3b4c5d6e7';
const ROLLBACK = new Error('ROLLBACK_FX');
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'FX', code: 'SYN-FX' });
  const usd = await db.currency.findUnique({ where: { code: 'USD' } });
  if (!usd) {
    const bdt = await db.currency.findUniqueOrThrow({ where: { code: 'BDT' } });
    await db.currency.create({ data: { ...bdt, code: 'USD', name: 'US Dollar' } as never });
  }
}, 120_000);
afterAll(() => db.$disconnect());

async function probe(body: (tx: Prisma.TransactionClient) => Promise<void>) {
  const ctx = { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, correlationId: randomUUID(), requestId: randomUUID() } as never;
  try { await runInTenantContext(ctx, () => db.$transaction(async tx => { await body(tx); throw ROLLBACK; }, { timeout: 60_000 })); }
  catch (error) { if (error !== ROLLBACK) throw error; }
}

describe('foreign currency revaluation', () => {
  it('trues a USD bank balance up to each period-end rate', async () => {
    await probe(async tx => {
      const acc = (code: string, cls: 'asset' | 'revenue' | 'liability') => tx.chartOfAccount.create({ data: { companyId: COMPANY_ID, code: `${code}-${randomUUID().slice(0, 6)}`, name: code,
        accountClass: cls, accountSubtype: 'other', normalBalance: cls === 'asset' ? 'D' : 'C', isActive: true } });
      const [bankCoa, gainLoss, funding] = [await acc('usd-bank', 'asset'), await acc('fx-gain-loss', 'revenue'), await acc('funding', 'liability')];
      await tx.accountingPolicy.update({ where: { companyId: COMPANY_ID }, data: { exchangeGainLossAccountId: gainLoss.id } });
      await tx.financialAccount.create({ data: { companyId: COMPANY_ID, name: 'USD bank', accountType: 'bank', currencyCode: 'USD', chartOfAccountId: bankCoa.id, isActive: true } });
      await postJournalEntry(tx, { companyId: COMPANY_ID, entryDate: new Date(), postingKind: 'test_funding', sourceType: 'test', sourceId: randomUUID(),
        description: '100 USD in', currencyCode: 'USD', exchangeRate: 110, createdBy: fx.user.id,
        lines: [{ chartOfAccountId: bankCoa.id, debit: 11000, credit: 0 }, { chartOfAccountId: funding.id, debit: 0, credit: 11000 }] }, randomUUID());

      const reval = (rate: number) => runRevaluation({ companyId: COMPANY_ID, currencyCode: 'USD', periodEndDate: new Date(), periodEndRate: rate, createdBy: fx.user.id }, tx);
      const bank = async () => { const t = await tx.journalLine.aggregate({ where: { companyId: COMPANY_ID, chartOfAccountId: bankCoa.id }, _sum: { debitBase: true, creditBase: true } });
        return new Prisma.Decimal(t._sum.debitBase ?? 0).minus(t._sum.creditBase ?? 0).toFixed(2); };

      const up = await reval(115);
      expect(up).toMatchObject({ totalUnrealizedGain: '500.00', totalUnrealizedLoss: '0.00' });
      expect(await bank()).toBe('11500.00');

      const same = await reval(115);
      expect(same.journalEntryId).toBeNull();
      expect(await bank()).toBe('11500.00');

      const down = await reval(112);
      expect(down).toMatchObject({ totalUnrealizedGain: '0.00', totalUnrealizedLoss: '300.00' });
      expect(await bank()).toBe('11200.00');
    });
  });
});
