// F-68 regression: report totals past the old 10,000-row cap.
//
// Every operational report read its rows with `take: 10000` and summed what came
// back with parseFloat, so past 10,000 qualifying rows its totals were silently
// short. AR aging also counted payments that had since been reversed and
// ignored posted returns, and the sales objective measured every target against
// the whole report window instead of the target's own period.
//
// This loads 10,001 sales and 10,002 stock rows into one company of the
// disposable MariaDB, plus a second company that must never show up, and
// checks the reports on both sides of the old boundary. Each run uses fresh
// company ids, which isolates it completely; the rows are left behind because
// payment allocations are immutable by trigger.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, type Branch } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  reportApAging, reportArAging, reportCourierCodReconciliation, reportDailySales, reportDashboardSummary,
  reportInventoryValuation, reportMonthlySales, reportProductInventory, reportSalesObjective,
  reportSalesSummary, reportStockAlert,
} from '@/reports';
import { runInTenantContext } from '@/lib/db/transaction';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const A = randomUUID();
const B = randomUUID();
const tag = A.slice(0, 8);

// 9,999 sales on D1, one on D2, one on D3: the three windows D1, D1..D2 and
// D1..D3 hold 9,999, 10,000 and 10,001 sales.
const D1 = new Date('2026-01-10T10:00:00Z');
const D2 = new Date('2026-01-11T10:00:00Z');
const D3 = new Date('2026-01-12T10:00:00Z');
const dayStart = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
const dayEnd = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T23:59:59.999Z`);
// Sales that exercise AR, dated before the summary windows.
const D0 = new Date('2026-01-05T10:00:00Z');

let branchA: Branch;
let branchB: Branch;
let userA: string;

const ctx = (companyId: string, branchIds?: string[]) => ({
  companyId, branchIds: branchIds ?? [], allBranches: !branchIds, isGlobal: false,
  correlationId: randomUUID(), requestId: randomUUID(),
}) as never;
const asA = <T>(work: () => Promise<T>) => runInTenantContext(ctx(A), work);

async function tenant(companyId: string, label: string) {
  const fixture = await ensureSyntheticIssuerTenant(db, { companyId, label, code: `SYN-RS${label}-${companyId.slice(0, 8)}` });
  const warehouse = await db.warehouse.create({ data: { companyId, branchId: fixture.branches[0].id, name: `WH ${label}`, code: `WH${label}` } });
  const category = await db.category.create({ data: { companyId, name: 'Scale', code: `CAT${label}` } });
  const unit = await db.unit.create({ data: { companyId, name: 'Piece', code: `PC${label}` } });
  const customer = await db.customer.create({ data: { companyId, name: `Customer ${label}` } });
  return { fixture, warehouse, category, unit, customer };
}

/** n sales of `amount`, in branch/warehouse, dated by `dateSql` over seq. */
async function bulkSales(companyId: string, prefix: string, n: number, amount: string, branchId: string, warehouseId: string,
  billerId: string, customerId: string, dateSql: string) {
  await db.$executeRawUnsafe(`
    INSERT INTO sales (id, company_id, branch_id, warehouse_id, reference_no, client_txn_id, biller_id, customer_id,
                       sale_status, grand_total, base_grand_total, business_date)
    SELECT CONCAT(?, seq), ?, ?, ?, CONCAT(?, seq), CONCAT(?, seq), ?, ?, 'completed', ?, ?, ${dateSql}
    FROM seq_1_to_${n}`,
  `${prefix}-`, companyId, branchId, warehouseId, `INV-${prefix}-`, `CT-${prefix}-`, billerId, customerId, amount, amount);
}

async function sale(companyId: string, t: Awaited<ReturnType<typeof tenant>>, ref: string, amount: string, businessDate = D0) {
  return db.sale.create({ data: {
    companyId, branchId: t.fixture.branches[0].id, warehouseId: t.warehouse.id, referenceNo: `${ref}-${tag}`,
    clientTxnId: randomUUID(), billerId: t.fixture.user.id, customerId: t.customer.id,
    grandTotal: amount, baseGrandTotal: amount, businessDate,
  } });
}

async function pay(companyId: string, t: Awaited<ReturnType<typeof tenant>>, saleId: string, amount: string, status: 'posted' | 'reversed') {
  const payment = await db.payment.create({ data: {
    companyId, branchId: t.fixture.branches[0].id, referenceNo: `PMT-${randomUUID()}`, clientTxnId: randomUUID(),
    paymentType: 'sale_receipt', financialAccountId: t.fixture.cash.id, amount, baseAmount: amount,
    paymentStatus: status, businessDate: D0, createdBy: t.fixture.user.id,
  } });
  const event = await db.businessEvent.create({ data: {
    companyId, eventType: 'payment.allocated', sourceType: 'payment', sourceId: payment.id, correlationId: randomUUID(),
  } });
  await db.paymentAllocation.create({ data: {
    companyId, paymentId: payment.id, eventId: event.id, eventLineNo: 1, saleId,
    allocatedAmount: amount, allocatedBaseAmount: amount, createdBy: t.fixture.user.id,
  } });
}

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318'
    || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  const a = await tenant(A, 'A');
  const b = await tenant(B, 'B');
  [branchA, branchB] = a.fixture.branches;
  userA = a.fixture.user.id;

  // ── Sales: 10,001 of 0.10 in A; three of 1,000.00 in B on the same day ──
  const date = `CASE WHEN seq <= 9999 THEN '${D1.toISOString().slice(0, 19).replace('T', ' ')}'
                     WHEN seq = 10000 THEN '${D2.toISOString().slice(0, 19).replace('T', ' ')}'
                     ELSE '${D3.toISOString().slice(0, 19).replace('T', ' ')}' END`;
  await bulkSales(A, `sa-${tag}`, 10_001, '0.10', branchA.id, a.warehouse.id, userA, a.customer.id, date);
  await bulkSales(B, `sb-${tag}`, 3, '1000.00', b.fixture.branches[0].id, b.warehouse.id, b.fixture.user.id, b.customer.id,
    `'${D1.toISOString().slice(0, 19).replace('T', ' ')}'`);

  // ── AR cases in A, before the summary windows ──
  const partial = await sale(A, a, 'AR-PARTIAL', '100.00');
  await pay(A, a, partial.id, '40.00', 'posted');           // due 60.00
  const reversed = await sale(A, a, 'AR-REVERSED', '50.00');
  await pay(A, a, reversed.id, '50.00', 'reversed');        // payment reversed: due 50.00
  const settled = await sale(A, a, 'AR-SETTLED', '20.00');
  await pay(A, a, settled.id, '20.00', 'posted');           // due 0
  const returned = await sale(A, a, 'AR-RETURNED', '30.00');
  await db.saleReturn.create({ data: {                      // credited in full: due 0
    companyId: A, branchId: branchA.id, warehouseId: a.warehouse.id, referenceNo: `RET-${tag}`, clientTxnId: randomUUID(),
    saleId: returned.id, status: 'posted', businessDate: D0, reason: 'probe', totalCredit: '30.00', baseTotalCredit: '30.00',
    createdBy: userA,
  } });

  // ── Stock: 10,001 low rows and one healthy row in A; two low rows in B ──
  // Value per row: ROUND(qty × 0.333333, 2) -> 0.33 for 1 unit, 33.33 for 100.
  const stock = async (companyId: string, t: Awaited<ReturnType<typeof tenant>>, prefix: string, n: number, healthy: number) => {
    await db.$executeRawUnsafe(`
      INSERT INTO products (id, company_id, name, code, category_id, unit_id, alert_quantity)
      SELECT CONCAT(?, seq), ?, CONCAT('Product ', seq), CONCAT(?, LPAD(seq, 6, '0')), ?, ?, 5 FROM seq_1_to_${n}`,
    `${prefix}-p-`, companyId, `P${prefix}-`, t.category.id, t.unit.id);
    await db.$executeRawUnsafe(`
      INSERT INTO warehouse_stocks (id, company_id, warehouse_id, product_id, qty_on_hand, qty_reserved, moving_average_cost)
      SELECT CONCAT(?, seq), ?, ?, CONCAT(?, seq), IF(seq = ${healthy}, 100, 1), 0, 0.333333 FROM seq_1_to_${n}`,
    `${prefix}-ws-`, companyId, t.warehouse.id, `${prefix}-p-`);
  };
  await stock(A, a, `a${tag}`, 10_002, 10_002);
  await stock(B, b, `b${tag}`, 2, 0);

  // ── COD: courier X has two orders, one settled; courier Y one unsettled ──
  const order = async (ref: string, courier: string, cod: string) => db.deliveryOrder.create({ data: {
    companyId: A, branchId: branchA.id, saleId: partial.id, referenceNo: `${ref}-${tag}`, recipientName: 'R', recipientPhone: '01700000000',
    addressSnapshot: 'Dhaka', deliveryMethod: 'courier', courierCode: courier, codAmount: cod, createdBy: userA,
  } });
  const x1 = await order('DO-X1', 'courier-x', '100.00');
  await order('DO-X2', 'courier-x', '50.00');
  await order('DO-Y1', 'courier-y', '70.00');
  await db.courierCodSettlement.create({ data: {
    companyId: A, branchId: branchA.id, referenceNo: `COD-${tag}`, courierCode: 'courier-x', settlementDate: new Date(),
    grossCodAmount: '100.00', feeAmount: '5.00', netReceivedAmount: '95.00', financialAccountId: a.fixture.cash.id, createdBy: userA,
    items: { create: [{ deliveryOrderId: x1.id, codAmount: '100.00', feeAmount: '5.00', adjustmentAmount: '0' }] },
  } });

  // ── Targets: the branch for D1 only; the user for D2..D3 ──
  await db.salesTarget.createMany({ data: [
    { companyId: A, branchId: branchA.id, periodStart: dayStart(D1), periodEnd: dayEnd(D1), targetAmount: '2000.00', createdBy: userA },
    { companyId: A, branchId: branchA.id, userId: userA, periodStart: dayStart(D2), periodEnd: dayEnd(D3), targetAmount: '1.00', createdBy: userA },
  ] });

  // ── Purchases: order totals with no allocation ──
  const supplier = await db.supplier.create({ data: { companyId: A, name: 'Supplier A' } });
  for (const [ref, total] of [['PO-1', '100.00'], ['PO-2', '200.00']]) {
    await db.purchase.create({ data: {
      companyId: A, branchId: branchA.id, warehouseId: a.warehouse.id, referenceNo: `${ref}-${tag}`, supplierId: supplier.id,
      orderDate: D0, grandTotal: total, baseGrandTotal: total, createdBy: userA,
    } });
  }
}, 300_000);

afterAll(() => db.$disconnect());

describe('sales summary across the old 10,000-row cap', () => {
  it.each([
    ['9,999', dayEnd(D1), 9_999, '999.90', false],
    ['10,000', dayEnd(D2), 10_000, '1000.00', false],
    ['10,001', dayEnd(D3), 10_001, '1000.10', true],
  ])('totals all %s qualifying sales', async (_label, to, sales, revenue, truncated) => {
    const report = await asA(() => reportSalesSummary(A, dayStart(D1), to));
    expect(report.summary).toMatchObject({ total_sales: sales, total_revenue: revenue, detail_truncated: truncated });
    expect(report.rows).toHaveLength(Math.min(sales, 10_000));
  });

  it('never includes another company', async () => {
    const report = await runInTenantContext(ctx(B), () => reportSalesSummary(B, dayStart(D1), dayEnd(D3)));
    expect(report.summary).toMatchObject({ total_sales: 3, total_revenue: '3000.00', detail_truncated: false });
  });

  it('is empty, not an error, for a window with no sales', async () => {
    const report = await asA(() => reportSalesSummary(A, new Date('2020-01-01'), new Date('2020-01-02')));
    expect(report.summary).toMatchObject({ total_sales: 0, total_revenue: '0.00', detail_rows: 0 });
  });

  it('groups every sale by day and month', async () => {
    const daily = await asA(() => reportDailySales(A, { fromDate: dayStart(D1), toDate: dayEnd(D3) }));
    expect(daily.rows.map(r => [r.day, r.sale_count, r.total])).toEqual([
      ['2026-01-10', 9_999, '999.90'], ['2026-01-11', 1, '0.10'], ['2026-01-12', 1, '0.10'],
    ]);
    expect(daily.summary).toMatchObject({ total_sales: 10_001, total_amount: '1000.10' });
    const monthly = await asA(() => reportMonthlySales(A, { fromDate: dayStart(D1), toDate: dayEnd(D3) }));
    expect(monthly.rows).toEqual([{ month: '2026-01', sale_count: 10_001, total: '1000.10', base_total: '1000.10' }]);
  });
});

describe('AR aging', () => {
  it('ages every open sale, net of live payments and posted returns', async () => {
    const report = await asA(() => reportArAging(A));
    // 10,001 × 0.10 + 60.00 (partly paid) + 50.00 (its payment was reversed).
    // The settled and fully returned sales owe nothing.
    expect(report.summary).toMatchObject({
      total_due: '1110.10', outstanding_documents: 10_003, detail_rows: 10_000, detail_truncated: true,
    });
    const refs = new Set(report.rows.map(r => r.reference_no));
    expect(refs.has(`AR-PARTIAL-${tag}`) && refs.has(`AR-REVERSED-${tag}`)).toBe(true);
    expect(refs.has(`AR-SETTLED-${tag}`) || refs.has(`AR-RETURNED-${tag}`)).toBe(false);
    expect(report.rows.find(r => r.reference_no === `AR-PARTIAL-${tag}`)!.amount_due).toBe('60.00');
  });

  it('agrees with the dashboard', async () => {
    const dashboard = await asA(() => reportDashboardSummary(A));
    expect(dashboard.summary).toMatchObject({ ar_outstanding: '1110.10', low_stock_count: 10_001 });
  });

  it('shows a branch-limited user only their branches', async () => {
    const report = await runInTenantContext(ctx(A, [branchB.id]), () => reportArAging(A));
    expect(report.summary).toMatchObject({ total_due: '0.00', outstanding_documents: 0 });
  });
});

describe('AP aging', () => {
  it('says its per-purchase amounts are not authoritative', async () => {
    const report = await asA(() => reportApAging(A));
    expect(report.summary).toMatchObject({ total_due: '300.00', outstanding_documents: 2, authoritative: false });
    expect(report.summary).toHaveProperty('ledger_ap_balance');
  });
});

describe('inventory past the old cap', () => {
  it('values every stock row', async () => {
    const report = await asA(() => reportInventoryValuation(A));
    // 10,001 × 0.33 + 33.33
    expect(report.summary).toMatchObject({ total_skus: 10_002, total_value: '3333.66', detail_rows: 10_000, detail_truncated: true });
  });

  it('counts every low-stock row, and only this company\'s', async () => {
    const report = await asA(() => reportStockAlert(A));
    expect(report.summary).toMatchObject({ low_stock_count: 10_001, detail_truncated: true });
    const other = await runInTenantContext(ctx(B), () => reportStockAlert(B));
    expect(other.summary).toMatchObject({ low_stock_count: 2, detail_truncated: false });
  });

  it('carries the same totals in the product inventory report', async () => {
    const report = await asA(() => reportProductInventory(A));
    expect(report.summary).toMatchObject({ total_skus: 10_002, total_value: '3333.66', detail_truncated: true });
  });

  it('shows nothing to a user without the warehouse\'s branch', async () => {
    const report = await runInTenantContext(ctx(A, [branchB.id]), () => reportInventoryValuation(A));
    expect(report.summary).toMatchObject({ total_skus: 0, total_value: '0.00' });
  });
});

describe('courier COD reconciliation', () => {
  it('attributes each settlement to its order\'s courier', async () => {
    const report = await asA(() => reportCourierCodReconciliation(A, { fromDate: new Date('2026-01-01'), toDate: new Date(Date.now() + 60_000) }));
    const byCourier = Object.fromEntries(report.rows.map(r => [r.courier, r]));
    expect(byCourier['courier-x']).toMatchObject({ cod_receivable: '150.00', settled_count: 1, settled_amount: '100.00', courier_fee: '5.00', net_settled: '95.00', outstanding: '50.00' });
    expect(byCourier['courier-y']).toMatchObject({ cod_receivable: '70.00', settled_count: 0, outstanding: '70.00' });
    expect(byCourier.unknown).toBeUndefined();
    expect(report.summary).toMatchObject({ total_receivable: '220.00', total_settled: '100.00', total_outstanding: '120.00' });
  });
});

describe('sales objective', () => {
  it('measures each target against its own period, over every sale', async () => {
    const report = await asA(() => reportSalesObjective(A, { fromDate: dayStart(D1), toDate: dayEnd(D3) }));
    const [branch, user] = report.rows;
    // The branch target covers D1: 9,999 × 0.10. Measured against the whole
    // window it would have been 1,000.10.
    expect(branch).toMatchObject({ user: '(branch total)', actual_amount: '999.90', achievement_pct: '50.00' });
    // The user target covers D2..D3: two sales.
    expect(user).toMatchObject({ actual_amount: '0.20', achievement_pct: '20.00' });
    expect(report.summary).toMatchObject({ total_target: '2001.00', total_actual: '1000.10', detail_truncated: false });
  });
});
