// Credit sales with a payment schedule, and collections against it, on the
// disposable MariaDB.
//
// PostSale booked the unpaid part of a credit sale to AR with no schedule, and
// POST /payments recorded later collections without linking them to any sale,
// so nothing could say what was due when or what remained. Now every credit
// sale has installments that add up to its unpaid amount, and
// CollectCustomerPayment applies collections oldest due first.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { withTenant } from '@/lib/db/transaction';
import { postSale } from '@/domain/commands/m3/PostSale';
import { reversePayment } from '@/domain/commands/m3/Payments';
import { collectCustomerPayment } from '@/domain/receivables/CollectCustomerPayment';
import { installmentBalances } from '@/domain/receivables/balances';
import { addDays, localDate } from '@/domain/receivables/calendar';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const A = randomUUID();
const B = randomUUID();
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let fxB: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let warehouseId: string;
let productId: string;

const ctx = (companyId = A, branchIds?: string[]) => ({
  companyId, branchIds: branchIds ?? [], allBranches: !branchIds, isGlobal: false,
  correlationId: randomUUID(), requestId: randomUUID(),
}) as never;
const today = () => localDate('Asia/Dhaka');

async function customer(companyId = A, phone: string | null = '01712345678') {
  return db.customer.create({ data: { companyId, name: `Credit customer ${randomUUID().slice(0, 6)}`, phone, creditLimit: 1_000_000 } });
}

/** A sale of `total` with `paid` received now; the rest on the given arrangement. */
function sell(customerId: string, total: number, paid: number, arrangement?: Parameters<typeof postSale>[1]['paymentArrangement'], extra: Partial<Parameters<typeof postSale>[1]> = {}) {
  return withTenant(ctx(), tx => postSale(tx, {
    companyId: A, branchId: fx.branches[0].id, warehouseId, cashierId: fx.user.id, customerId,
    currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date(),
    items: [{ productId, qty: 1, unitPrice: total }],
    payments: paid > 0 ? [{ paymentMethod: 'cash', amount: paid, financialAccountId: fx.cash.id }] : [],
    paymentArrangement: arrangement, ...extra,
  }, randomUUID()));
}

function collect(customerId: string, amount: string, extra: Partial<Parameters<typeof collectCustomerPayment>[1]> = {}) {
  return withTenant(ctx(), tx => collectCustomerPayment(tx, {
    companyId: A, branchId: fx.branches[0].id, customerId, amount, financialAccountId: fx.cash.id,
    paymentMethod: 'cash', businessDate: new Date(), collectedBy: fx.user.id, ...extra,
  }, randomUUID()));
}

const balances = (customerId: string) => withTenant(ctx(), tx => installmentBalances(tx, A, { customerId }));
const outstanding = async (customerId: string) => (await balances(customerId)).map(b => b.outstanding.toFixed(2));

beforeAll(async () => {
  fx = await ensureSyntheticIssuerTenant(db, { companyId: A, label: 'CC', code: `SYN-CC-${A.slice(0, 8)}` });
  fxB = await ensureSyntheticIssuerTenant(db, { companyId: B, label: 'CD', code: `SYN-CD-${B.slice(0, 8)}` });
  for (const companyId of [A, B]) {
    const user = companyId === A ? fx.user.id : fxB.user.id;
    await db.featureFlag.upsert({ where: { companyId_flagKey: { companyId, flagKey: 'credit_sales' } },
      update: { enabled: true }, create: { companyId, flagKey: 'credit_sales', enabled: true, updatedBy: user } });
  }
  warehouseId = (await db.warehouse.create({ data: { companyId: A, branchId: fx.branches[0].id, name: 'Credit WH', code: 'CCWH' } })).id;
  const category = await db.category.create({ data: { companyId: A, name: 'Credit', code: 'CCCAT' } });
  const unit = await db.unit.create({ data: { companyId: A, name: 'Piece', code: 'CCPC' } });
  // A service needs no stock, so any number of sales can be made from it.
  productId = (await db.product.create({ data: { companyId: A, name: 'Credit plan', code: 'CC-1', productType: 'service', categoryId: category.id, unitId: unit.id } })).id;
}, 120_000);

afterAll(() => db.$disconnect());

describe('credit sale schedule', () => {
  it('schedules the unpaid part in installments that add up exactly', async () => {
    const c = await customer();
    const sale = await sell(c.id, 50_000, 20_000, { type: 'installments', installments: [
      { dueDate: addDays(today(), 12), amount: '10000' },
      { dueDate: addDays(today(), 43), amount: '10000' },
      { dueDate: addDays(today(), 73), amount: '10000' },
    ] });
    const rows = await db.installment.findMany({ where: { saleId: sale.saleId }, orderBy: { installmentNo: 'asc' } });
    expect(rows.map(r => [r.installmentNo, r.amount.toFixed(2), r.status])).toEqual([[1, '10000.00', 'scheduled'], [2, '10000.00', 'scheduled'], [3, '10000.00', 'scheduled']]);
    expect(await outstanding(c.id)).toEqual(['10000.00', '10000.00', '10000.00']);
    // The number used for the sale is kept on the sale, normalized.
    expect((await db.sale.findUniqueOrThrow({ where: { id: sale.saleId } })).customerPhoneSnapshot).toBe('8801712345678');
  });

  it('gives a credit sale with no arrangement one installment after the credit period', async () => {
    const c = await customer();
    const sale = await sell(c.id, 15_000, 0);
    const [only] = await db.installment.findMany({ where: { saleId: sale.saleId } });
    expect(only.amount.toFixed(2)).toBe('15000.00');
    expect(only.dueDate.toISOString().slice(0, 10)).toBe(addDays(today(), 30));
  });

  it('refuses a schedule that does not add up, and writes nothing', async () => {
    const c = await customer();
    await expect(sell(c.id, 50_000, 20_000, { type: 'installments', installments: [
      { dueDate: addDays(today(), 10), amount: '10000' }, { dueDate: addDays(today(), 40), amount: '19999.99' },
    ] })).rejects.toThrow(/total 29999.99 but 30000.00 is unpaid/);
    expect(await db.sale.count({ where: { companyId: A, customerId: c.id } })).toBe(0);
  });

  it('refuses an invalid reminder number instead of storing it', async () => {
    const c = await customer();
    await expect(sell(c.id, 1_000, 0, undefined, { reminderPhone: '0171234' })).rejects.toThrow(/not a valid Bangladesh mobile/);
  });

  it('schedules nothing for a sale paid in full', async () => {
    const c = await customer();
    const sale = await sell(c.id, 1_000, 1_000);
    expect(await db.installment.count({ where: { saleId: sale.saleId } })).toBe(0);
  });
});

describe('collections', () => {
  it('applies a payment oldest due first, across sales', async () => {
    const c = await customer();
    await sell(c.id, 3_000, 0, { type: 'installments', installments: [
      { dueDate: addDays(today(), 5), amount: '1000' }, { dueDate: addDays(today(), 20), amount: '2000' },
    ] });
    await sell(c.id, 500, 0, { type: 'due', dueDate: addDays(today(), 10) });
    // Oldest first: 1000 (day 5), then 500 (day 10), then 250 of 2000 (day 20).
    const result = await collect(c.id, '1750');
    expect(result.applied.map(a => [a.amount, a.remaining])).toEqual([['1000.00', '0.00'], ['500.00', '0.00'], ['250.00', '1750.00']]);
    expect(result.customerOutstanding).toBe('1750.00');
    expect(await outstanding(c.id)).toEqual(['0.00', '0.00', '1750.00']);
  });

  it('posts the collection to the ledger against AR, for the customer', async () => {
    const c = await customer();
    await sell(c.id, 2_000, 0);
    const result = await collect(c.id, '800');
    const entry = await db.journalEntry.findFirstOrThrow({ where: { companyId: A, sourceType: 'payment', sourceId: result.paymentId }, include: { lines: true } });
    const policy = await db.accountingPolicy.findUniqueOrThrow({ where: { companyId: A } });
    const ar = entry.lines.find(l => l.chartOfAccountId === policy.arAccountId)!;
    expect(ar.creditBase.toFixed(2)).toBe('800.00');
    expect(ar.customerId).toBe(c.id);
    // The sale's own AR debit carries the customer too, so the ledger nets to what is owed.
    const net = await db.journalLine.aggregate({ where: { companyId: A, customerId: c.id, chartOfAccountId: policy.arAccountId }, _sum: { debitBase: true, creditBase: true } });
    expect(new Prisma.Decimal(net._sum.debitBase!).minus(net._sum.creditBase!).toFixed(2)).toBe('1200.00');
  });

  it('takes AR off the branch that made the sale, cash on the branch that collected', async () => {
    const c = await customer();
    const branchB = fx.branches[1].id;
    const whB = await db.warehouse.create({ data: { companyId: A, branchId: branchB, name: 'Branch B WH', code: `CCB${randomUUID().slice(0, 4)}` } });
    await withTenant(ctx(), tx => postSale(tx, {
      companyId: A, branchId: branchB, warehouseId: whB.id, cashierId: fx.user.id, customerId: c.id,
      currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date(), items: [{ productId, qty: 1, unitPrice: 900 }], payments: [],
    }, randomUUID()));
    const result = await collect(c.id, '900'); // collected at branch A
    const lines = await db.journalLine.findMany({ where: { companyId: A, journalEntry: { sourceType: 'payment', sourceId: result.paymentId } } });
    const policy = await db.accountingPolicy.findUniqueOrThrow({ where: { companyId: A } });
    expect(lines.find(l => l.chartOfAccountId === policy.arAccountId)).toMatchObject({ branchId: branchB });
    expect(lines.find(l => l.chartOfAccountId !== policy.arAccountId)).toMatchObject({ branchId: fx.branches[0].id });
  });

  it('applies only to the invoices the cashier picks', async () => {
    const c = await customer();
    const first = await sell(c.id, 1_000, 0, { type: 'due', dueDate: addDays(today(), 3) });
    const second = await sell(c.id, 1_000, 0, { type: 'due', dueDate: addDays(today(), 9) });
    const result = await collect(c.id, '400', { saleIds: [second.saleId] });
    expect(result.applied.map(a => a.saleId)).toEqual([second.saleId]);
    expect(first.saleId).not.toBe(second.saleId);
    expect(await outstanding(c.id)).toEqual(['1000.00', '600.00']);
  });

  it('refuses more than is owed, and anything for a customer who owes nothing', async () => {
    const c = await customer();
    await sell(c.id, 1_000, 0);
    await expect(collect(c.id, '1000.01')).rejects.toThrow(/owes 1000.00.*customer advance/);
    await collect(c.id, '1000');
    await expect(collect(c.id, '1')).rejects.toThrow(/Nothing is outstanding/);
  });

  it('reopens the installments when the payment is reversed', async () => {
    const c = await customer();
    await sell(c.id, 1_000, 0);
    const result = await collect(c.id, '1000');
    expect(await outstanding(c.id)).toEqual(['0.00']);
    await withTenant(ctx(), tx => reversePayment(tx, { companyId: A, paymentId: result.paymentId, reversedBy: fx.user.id, reason: 'bounced' }, randomUUID()));
    expect(await outstanding(c.id)).toEqual(['1000.00']);
  });

  it('applies two simultaneous collections one after the other, never beyond what is owed', async () => {
    const c = await customer();
    await sell(c.id, 1_000, 0);
    const results = await Promise.allSettled([collect(c.id, '700'), collect(c.id, '700')]);
    // One succeeds; the other sees 300 outstanding and is refused (or loses the
    // serialization race and is rolled back). Never 1,400 against 1,000.
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await outstanding(c.id)).toEqual(['300.00']);
  }, 60_000);

  it('never reaches another company\'s customer or sales', async () => {
    const c = await customer();
    await sell(c.id, 1_000, 0);
    await expect(withTenant(ctx(B), tx => collectCustomerPayment(tx, {
      companyId: B, branchId: fxB.branches[0].id, customerId: c.id, amount: '100', financialAccountId: fxB.cash.id,
      paymentMethod: 'cash', businessDate: new Date(), collectedBy: fxB.user.id,
    }, randomUUID()))).rejects.toThrow(/Customer not found/);
    expect(await withTenant(ctx(B), tx => installmentBalances(tx, B, { customerId: c.id }))).toEqual([]);
  });
});

describe('credit checks from installment balances', () => {
  it('allows a returning customer whose earlier sales are paid', async () => {
    const c = await customer();
    await sell(c.id, 1_000, 1_000);
    // The old check refused credit to anyone with any sale older than 30 days;
    // a paid history must not block a new credit sale.
    await expect(sell(c.id, 2_000, 0)).resolves.toMatchObject({ saleStatus: 'completed' });
  });

  it('blocks new credit while an installment is overdue', async () => {
    const c = await customer();
    const sale = await sell(c.id, 1_000, 0, { type: 'due', dueDate: today() });
    // Make it overdue: due yesterday.
    await db.installment.updateMany({ where: { saleId: sale.saleId }, data: { dueDate: new Date(`${addDays(today(), -1)}T00:00:00Z`) } });
    await expect(sell(c.id, 500, 0)).rejects.toThrow(/overdue installment/);
    await collect(c.id, '1000');
    await expect(sell(c.id, 500, 0)).resolves.toMatchObject({ saleStatus: 'completed' });
  });
});
