// Fixed-asset depreciation (disposable MariaDB, rolled back):
//   - straight line by calendar months, exact to the paisa, and the asset
//     records the same rounded amount the journal posts;
//   - a period that overlaps one already depreciated is refused.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postDepreciation } from '@/domain/commands/m4/AssetManagement';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';
import { runInTenantContext } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = 'f2a4b5c6-d7e8-4f34-c567-8192a3b4c5d6';
const ROLLBACK = new Error('ROLLBACK_DEPRECIATION');
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'DP', code: 'SYN-DP' });
}, 120_000);
afterAll(() => db.$disconnect());

async function probe(body: (tx: Prisma.TransactionClient) => Promise<void>) {
  const ctx = { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, correlationId: randomUUID(), requestId: randomUUID() } as never;
  try { await runInTenantContext(ctx, () => db.$transaction(async tx => { await body(tx); throw ROLLBACK; }, { timeout: 60_000 })); }
  catch (error) { if (error !== ROLLBACK) throw error; }
}

describe('depreciation', () => {
  it('posts exact calendar-month amounts and refuses an overlapping period', async () => {
    await probe(async tx => {
      const acc = (code: string, cls: 'asset' | 'expense') => tx.chartOfAccount.create({ data: { companyId: COMPANY_ID, code: `${code}-${randomUUID().slice(0, 6)}`, name: code,
        accountClass: cls, accountSubtype: cls === 'asset' ? 'current_asset' : 'operating_expense', normalBalance: 'D', isActive: true } });
      const [assetAcc, accum, expense] = [await acc('fa', 'asset'), await acc('accum', 'asset'), await acc('dep', 'expense')];
      // 10,000 over 7 months: 1,428.571428… a month.
      const asset = await tx.fixedAsset.create({ data: { companyId: COMPANY_ID, assetCode: `FA-${randomUUID().slice(0, 6)}`, name: 'Delivery van',
        purchaseDate: new Date(), purchaseCost: 10000, usefulLifeMonths: 7, netBookValue: 10000,
        assetAccountId: assetAcc.id, accumDepAccountId: accum.id, depExpenseAccountId: expense.id, createdBy: fx.user.id } });
      const run = (from: string, to: string) => postDepreciation(tx, { companyId: COMPANY_ID, fixedAssetId: asset.id,
        periodStart: new Date(`${from}T00:00:00Z`), periodEnd: new Date(`${to}T00:00:00Z`), createdBy: fx.user.id }, randomUUID());

      expect((await run('2026-01-01', '2026-01-31')).depreciationAmount).toBe('1428.57');
      await expect(run('2026-01-15', '2026-02-28')).rejects.toThrow(/already depreciated/);
      expect((await run('2026-02-01', '2026-03-31')).depreciationAmount).toBe('2857.14');

      const after = await tx.fixedAsset.findUniqueOrThrow({ where: { id: asset.id } });
      expect(new Prisma.Decimal(after.accumulatedDepreciation).toFixed(2)).toBe('4285.71');
      expect(new Prisma.Decimal(after.netBookValue).toFixed(2)).toBe('5714.29');
      const posted = await tx.journalLine.aggregate({ where: { companyId: COMPANY_ID, chartOfAccountId: expense.id }, _sum: { debitBase: true } });
      expect(new Prisma.Decimal(posted._sum.debitBase ?? 0).toFixed(2)).toBe('4285.71');
    });
  });
});
