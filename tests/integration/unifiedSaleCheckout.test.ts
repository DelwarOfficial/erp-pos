// The one New Sale page posts full, part-paid and fully credit sales through
// the same command. Against the disposable MariaDB, rolled back each time:
//   - fully paid: no installments, nothing owed
//   - part paid: the rest on equal installments every 30 days, exact to the paisa
//   - fully credit: one due date for the whole total
//   - the line discount is stored on the sale as sold (snapshot), with its tax
//   - a balance needs a customer
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postSale } from '@/domain/commands/m3/PostSale';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';
import { runInTenantContext } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = '8b3d4e5f-6071-4c8d-ae9f-1a2b3c4d5e6f';
const ROLLBACK = new Error('ROLLBACK_UNIFIED_SALE');
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'US', code: 'SYN-US' });
}, 120_000);
afterAll(() => db.$disconnect());

async function probe(body: (tx: Prisma.TransactionClient) => Promise<void>) {
  // Credit checks read balances through tenant-scoped SQL, so run inside the tenant's context.
  const ctx = { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, correlationId: randomUUID(), requestId: randomUUID() } as never;
  try { await runInTenantContext(ctx, () => db.$transaction(async tx => { await body(tx); throw ROLLBACK; }, { timeout: 60_000 })); }
  catch (error) { if (error !== ROLLBACK) throw error; }
}

async function setup(tx: Prisma.TransactionClient) {
  const branch = fx.branches[0];
  let warehouse = await tx.warehouse.findFirst({ where: { companyId: COMPANY_ID, branchId: branch.id } });
  if (!warehouse) warehouse = await tx.warehouse.create({ data: { companyId: COMPANY_ID, branchId: branch.id, code: 'WH-US', name: 'US warehouse', isActive: true } });
  let unit = await tx.unit.findFirst({ where: { companyId: COMPANY_ID } });
  if (!unit) unit = await tx.unit.create({ data: { companyId: COMPANY_ID, code: 'pc', name: 'Piece' } });
  let category = await tx.category.findFirst({ where: { companyId: COMPANY_ID } });
  if (!category) category = await tx.category.create({ data: { companyId: COMPANY_ID, code: 'gen', name: 'General' } });
  const product = await tx.product.create({ data: { companyId: COMPANY_ID, code: `US-${randomUUID().slice(0, 8)}`, name: 'Fridge',
    productType: 'standard', unitId: unit.id, categoryId: category.id, defaultPrice: 10000, referenceCost: 7000, isActive: true } });
  await tx.warehouseStock.create({ data: { companyId: COMPANY_ID, warehouseId: warehouse.id, productId: product.id, qtyOnHand: 20, movingAverageCost: 7000 } });
  const customer = await tx.customer.create({ data: { companyId: COMPANY_ID, name: 'Rahim', phone: '01711000000', creditLimit: 100000 } });
  const flag = await tx.featureFlag.findFirst({ where: { companyId: COMPANY_ID, flagKey: 'credit_sales' } });
  if (flag) await tx.featureFlag.update({ where: { id: flag.id }, data: { enabled: true } });
  else await tx.featureFlag.create({ data: { companyId: COMPANY_ID, flagKey: 'credit_sales', enabled: true, rolloutRules: '{}', updatedBy: fx.user.id } });
  const base = { companyId: COMPANY_ID, branchId: warehouse.branchId, warehouseId: warehouse.id, cashierId: fx.user.id,
    currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date() };
  return { product, customer, base, discountApproved: true };
}

describe('one New Sale command: full, part and credit', () => {
  it('fully paid: 2 × 10,000 with a 1,000 line discount (5%) is stored as sold and owes nothing', async () => {
    await probe(async tx => {
      const s = await setup(tx);
      const sale = await postSale(tx, { ...s.base, discountApproved: true,
        items: [{ productId: s.product.id, qty: 2, unitPrice: 10000, discountAmount: 1000 }],
        payments: [{ paymentMethod: 'cash', amount: 19000, financialAccountId: fx.cash.id }] }, randomUUID());
      expect(sale).toMatchObject({ subtotal: '20000', discountTotal: '1000', grandTotal: '19000' });
      const item = await tx.saleItem.findFirstOrThrow({ where: { saleId: sale.saleId } });
      expect(new Prisma.Decimal(item.unitPriceSnapshot).toFixed(2)).toBe('10000.00');
      expect(new Prisma.Decimal(item.grossAmount).toFixed(2)).toBe('20000.00');
      expect(new Prisma.Decimal(item.discountAmount).toFixed(2)).toBe('1000.00');
      expect(await tx.installment.count({ where: { saleId: sale.saleId } })).toBe(0);
    });
  });

  it('part paid: 5,000 now, the 15,000 rest in 3 equal installments every 30 days', async () => {
    await probe(async tx => {
      const s = await setup(tx);
      const sale = await postSale(tx, { ...s.base, customerId: s.customer.id,
        items: [{ productId: s.product.id, qty: 2, unitPrice: 10000 }],
        payments: [{ paymentMethod: 'cash', amount: 5000, financialAccountId: fx.cash.id }],
        paymentArrangement: { type: 'equal', count: 3, firstDueDate: '2099-01-31', intervalDays: 30 } }, randomUUID());
      const rows = await tx.installment.findMany({ where: { saleId: sale.saleId }, orderBy: { installmentNo: 'asc' } });
      expect(rows.map(r => new Prisma.Decimal(r.amount).toFixed(2))).toEqual(['5000.00', '5000.00', '5000.00']);
      expect(rows.map(r => r.dueDate.toISOString().slice(0, 10))).toEqual(['2099-01-31', '2099-03-02', '2099-04-01']);
    });
  });

  it('fully on credit: one due date for the whole total, uneven totals exact to the paisa', async () => {
    await probe(async tx => {
      const s = await setup(tx);
      const sale = await postSale(tx, { ...s.base, customerId: s.customer.id, discountApproved: true,
        items: [{ productId: s.product.id, qty: 1, unitPrice: 10000, discountAmount: 0.01 }], payments: [],
        paymentArrangement: { type: 'due', dueDate: '2099-02-01' } }, randomUUID());
      const rows = await tx.installment.findMany({ where: { saleId: sale.saleId } });
      expect(rows).toHaveLength(1);
      expect(new Prisma.Decimal(rows[0].amount).toFixed(2)).toBe(new Prisma.Decimal(sale.grandTotal).toFixed(2));
    });
  });

  it('a balance without a customer is refused', async () => {
    await probe(async tx => {
      const s = await setup(tx);
      await expect(postSale(tx, { ...s.base, items: [{ productId: s.product.id, qty: 1, unitPrice: 10000 }], payments: [],
        paymentArrangement: { type: 'due', dueDate: '2099-02-01' } }, randomUUID())).rejects.toThrow(/registered customer/);
    });
  });
});
