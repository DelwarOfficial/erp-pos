// Reward points and coupons (disposable MariaDB, rolled back):
//   points: 1 per ৳100 paid, worth ৳1 as a tender, liability on the books,
//           taken back / given back on void, taken back on return, lapse
//           after 12 months;
//   coupons: % with a cap or fixed ৳, spread over lines before tax, a use
//           limit enforced at posting, given back on void.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postSale } from '@/domain/commands/m3/PostSale';
import { voidSale } from '@/domain/commands/m3/VoidSale';
import { expirePoints, pointsBalance } from '@/domain/loyalty/points';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';
import { runInTenantContext } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = 'c5d7e8f9-0a12-4c67-f890-b4c5d6e7f809';
const ROLLBACK = new Error('ROLLBACK_LOYALTY');
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'LY', code: 'SYN-LY' });
}, 120_000);
afterAll(() => db.$disconnect());

async function probe(body: (tx: Prisma.TransactionClient) => Promise<void>) {
  const ctx = { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, correlationId: randomUUID(), requestId: randomUUID() } as never;
  try { await runInTenantContext(ctx, () => db.$transaction(async tx => { await body(tx); throw ROLLBACK; }, { timeout: 60_000 })); }
  catch (error) { if (error !== ROLLBACK) throw error; }
}

async function setup(tx: Prisma.TransactionClient) {
  const branch = fx.branches[0];
  let warehouse = await tx.warehouse.findFirst({ where: { companyId: COMPANY_ID, branchId: branch.id } });
  if (!warehouse) warehouse = await tx.warehouse.create({ data: { companyId: COMPANY_ID, branchId: branch.id, code: 'WH-LY', name: 'LY', isActive: true } });
  let unit = await tx.unit.findFirst({ where: { companyId: COMPANY_ID } });
  if (!unit) unit = await tx.unit.create({ data: { companyId: COMPANY_ID, code: 'pc', name: 'Piece' } });
  let category = await tx.category.findFirst({ where: { companyId: COMPANY_ID } });
  if (!category) category = await tx.category.create({ data: { companyId: COMPANY_ID, code: 'gen', name: 'General' } });
  const product = await tx.product.create({ data: { companyId: COMPANY_ID, code: `LY-${randomUUID().slice(0, 8)}`, name: 'Cable', productType: 'standard',
    unitId: unit.id, categoryId: category.id, defaultPrice: 350, referenceCost: 180, isActive: true } });
  await tx.warehouseStock.create({ data: { companyId: COMPANY_ID, warehouseId: warehouse.id, productId: product.id, qtyOnHand: 50, movingAverageCost: 180 } });
  const acc = (code: string, cls: 'liability' | 'expense', subtype: string) => tx.chartOfAccount.create({ data: { companyId: COMPANY_ID, code: `${code}-${randomUUID().slice(0, 6)}`, name: code,
    accountClass: cls, accountSubtype: subtype, normalBalance: cls === 'liability' ? 'C' : 'D', isActive: true } });
  const liability = await acc('points', 'liability', 'reward_points_liability');
  const expense = await acc('reward', 'expense', 'reward_expense');
  await tx.accountingPolicy.update({ where: { companyId: COMPANY_ID }, data: { rewardExpenseAccountId: expense.id } });
  const customer = await tx.customer.create({ data: { companyId: COMPANY_ID, name: 'Rahim', phone: '01711000222' } });
  const base = { companyId: COMPANY_ID, branchId: warehouse.branchId, warehouseId: warehouse.id, cashierId: fx.user.id, currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date() };
  const net = async (accountId: string) => { const t = await tx.journalLine.aggregate({ where: { companyId: COMPANY_ID, chartOfAccountId: accountId }, _sum: { debitBase: true, creditBase: true } });
    return new Prisma.Decimal(t._sum.debitBase ?? 0).minus(t._sum.creditBase ?? 0).toFixed(2); };
  return { product, customer, base, liability, expense, net };
}

describe('reward points', () => {
  it('earns on money paid, spends as a tender, and a void gives back and takes back', async () => {
    await probe(async tx => {
      const s = await setup(tx);
      const balance = () => pointsBalance(tx, COMPANY_ID, s.customer.id);
      // 2 × 350 = 700 paid: 7 points, ৳7 liability.
      await postSale(tx, { ...s.base, customerId: s.customer.id, items: [{ productId: s.product.id, qty: 2, unitPrice: 350 }],
        payments: [{ paymentMethod: 'cash', amount: 700, financialAccountId: fx.cash.id }] }, randomUUID());
      expect(await balance()).toBe(7);
      expect(await s.net(s.liability.id)).toBe('-7.00');

      // 350: 5 points + 345 cash. Earns floor(345 / 100) = 3 on the cash only.
      const spend = await postSale(tx, { ...s.base, customerId: s.customer.id, items: [{ productId: s.product.id, qty: 1, unitPrice: 350 }],
        payments: [{ paymentMethod: 'reward_points', amount: 5, financialAccountId: fx.cash.id }, { paymentMethod: 'cash', amount: 345, financialAccountId: fx.cash.id }] }, randomUUID());
      expect(spend.pointsEarned).toBe(3);
      expect(await balance()).toBe(5); // 7 − 5 + 3
      expect(await s.net(s.liability.id)).toBe('-5.00');

      await expect(postSale(tx, { ...s.base, customerId: s.customer.id, items: [{ productId: s.product.id, qty: 1, unitPrice: 350 }],
        payments: [{ paymentMethod: 'reward_points', amount: 50, financialAccountId: fx.cash.id }, { paymentMethod: 'cash', amount: 300, financialAccountId: fx.cash.id }] }, randomUUID()))
        .rejects.toThrow(/has 5 points/);

      // Void: the 5 spent come back, the 3 earned go.
      await voidSale(tx, { saleId: spend.saleId, companyId: COMPANY_ID, voidedBy: fx.user.id, reason: 'probe' }, randomUUID());
      expect(await balance()).toBe(7);
      expect(await s.net(s.liability.id)).toBe('-7.00');
    });
  });

  it('lapses points 12 months after they were earned', async () => {
    await probe(async tx => {
      const s = await setup(tx);
      await tx.rewardPointTransaction.create({ data: { companyId: COMPANY_ID, customerId: s.customer.id, entryType: 'earn', pointsDelta: 40, expiresAt: new Date(Date.now() - 1000) } });
      expect(await pointsBalance(tx, COMPANY_ID, s.customer.id)).toBe(0); // expired lots are not spendable
      expect(await expirePoints(tx, COMPANY_ID, new Date(), fx.user.id)).toBe(40);
      expect(await expirePoints(tx, COMPANY_ID, new Date(), fx.user.id)).toBe(0); // once only
      expect(await s.net(s.expense.id)).toBe('-40.00');
    });
  });
});

describe('coupons', () => {
  it('takes 10% capped at ৳50, spread over the lines, once only, and a void gives the use back', async () => {
    await probe(async tx => {
      const s = await setup(tx);
      await tx.coupon.create({ data: { companyId: COMPANY_ID, code: 'EID10', name: 'Eid 10%', discountType: 'percentage', value: 10, maxDiscountAmount: 50,
        minOrderAmount: 500, validFrom: new Date('2020-01-01'), usageLimit: 1 } });
      const sale = (amount: number) => postSale(tx, { ...s.base, couponCode: 'eid10', items: [{ productId: s.product.id, qty: 1, unitPrice: 350 }, { productId: s.product.id, qty: 1, unitPrice: 350 }],
        payments: [{ paymentMethod: 'cash', amount, financialAccountId: fx.cash.id }] }, randomUUID());
      const first = await sale(650); // 700 − min(70, 50)
      expect(first).toMatchObject({ discountTotal: '50', grandTotal: '650' });
      const lines = await tx.saleItem.findMany({ where: { saleId: first.saleId }, orderBy: { lineNo: 'asc' } });
      expect(lines.map(l => new Prisma.Decimal(l.discountAmount).toFixed(2))).toEqual(['25.00', '25.00']);
      await expect(sale(650)).rejects.toThrow(/used up/);

      await voidSale(tx, { saleId: first.saleId, companyId: COMPANY_ID, voidedBy: fx.user.id, reason: 'probe' }, randomUUID());
      await expect(sale(650)).resolves.toMatchObject({ grandTotal: '650' });
    });
  });

  it('refuses a coupon below its minimum spend or after it ends', async () => {
    await probe(async tx => {
      const s = await setup(tx);
      await tx.coupon.create({ data: { companyId: COMPANY_ID, code: 'BIG', name: 'Big spend', discountType: 'fixed', value: 100, minOrderAmount: 5000, validFrom: new Date('2020-01-01') } });
      await tx.coupon.create({ data: { companyId: COMPANY_ID, code: 'OLD', name: 'Old', discountType: 'fixed', value: 100, validFrom: new Date('2020-01-01'), validTo: new Date('2021-01-01') } });
      const sale = (code: string) => postSale(tx, { ...s.base, couponCode: code, items: [{ productId: s.product.id, qty: 1, unitPrice: 350 }],
        payments: [{ paymentMethod: 'cash', amount: 250, financialAccountId: fx.cash.id }] }, randomUUID());
      await expect(sale('BIG')).rejects.toThrow(/at least ৳5000.00/);
      await expect(sale('OLD')).rejects.toThrow(/expired/);
    });
  });
});
