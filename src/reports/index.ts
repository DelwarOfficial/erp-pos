// src/reports/index.ts
// Report definitions per §11.5 catalogue.
// Each report is a function that queries the DB and returns structured data.

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { computeTrialBalance, LEDGER_STATUSES } from '@/lib/accounting/trialBalance';
import { reportSqlScope, type ReportSqlScope } from './sqlScope';

// The ledger reports below (trial balance, P&L, balance sheet, customer and
// supplier ledgers) shared four defects, the same ones fixed in the trial
// balance API (see src/lib/accounting/trialBalance.ts):
//
//   - `take: 10000`: once a company passed 10,000 journal lines -- a few weeks of
//     POS trading -- every figure was computed from a silently truncated ledger
//     and still looked plausible;
//   - status 'posted' only: a reversed original was dropped while its reversal
//     was counted, so a voided sale showed as negative revenue;
//   - parseFloat summation of DECIMAL(65,30) amounts;
//   - party ledgers started their running balance at zero on the `from` date,
//     ignoring everything before it.
//
// Account totals are now aggregated in the database, in Decimal, over the whole
// ledger; party ledgers open with the balance brought forward.
const Dec = Prisma.Decimal;

// The operational reports further down had the same `take: 10000` and
// parseFloat summation, and computed their totals from whatever rows came back.
// Past 10,000 qualifying rows every total was silently understated.
//
// Now every summary is computed in the database over the complete qualifying
// set, in DECIMAL. Where a report also lists rows, the list is capped at
// DETAIL_LIMIT (the old cap, so no response grows) and the summary says how many
// rows qualified, how many are listed, and whether the list was cut short.
const DETAIL_LIMIT = 10_000;
const SALE_STATUSES = ['completed', 'partially_returned'];

function detailMeta(listed: number, qualifying: number) {
  return { detail_rows: listed, detail_row_limit: DETAIL_LIMIT, detail_truncated: listed < qualifying };
}

const dec = (value: Prisma.Decimal.Value | null | undefined) => new Dec(value ?? 0);
const count = (value: bigint | number | null | undefined) => Number(value ?? 0);

/** The balance of one control account from the ledger, on its normal side. */
async function controlAccountBalance(companyId: string, account: 'arAccountId' | 'apAccountId') {
  const policy = await db.accountingPolicy.findUnique({ where: { companyId }, select: { arAccountId: true, apAccountId: true } });
  if (!policy) return null;
  const totals = await db.journalLine.aggregate({
    where: { companyId, chartOfAccountId: policy[account], journalEntry: { companyId, status: { in: [...LEDGER_STATUSES] } } },
    _sum: { debitBase: true, creditBase: true },
  });
  const debit = dec(totals._sum.debitBase);
  const credit = dec(totals._sum.creditBase);
  return (account === 'arAccountId' ? debit.minus(credit) : credit.minus(debit)).toFixed(2);
}

async function accountTotals(companyId: string, entryDate: Prisma.DateTimeFilter) {
  const grouped = await db.journalLine.groupBy({
    by: ['chartOfAccountId'],
    where: { companyId, journalEntry: { companyId, status: { in: [...LEDGER_STATUSES] }, entryDate } },
    _sum: { debitBase: true, creditBase: true },
  });
  const accounts = grouped.length === 0 ? [] : await db.chartOfAccount.findMany({
    where: { companyId, id: { in: grouped.map(row => row.chartOfAccountId) } },
    select: { id: true, code: true, name: true, accountClass: true, normalBalance: true },
  });
  const byId = new Map(accounts.map(account => [account.id, account]));
  return grouped.flatMap(row => {
    const account = byId.get(row.chartOfAccountId);
    if (!account) return [];
    return [{
      ...account,
      debit: new Dec(row._sum.debitBase ?? 0),
      credit: new Dec(row._sum.creditBase ?? 0),
    }];
  });
}

async function partyLedger(
  companyId: string,
  party: { customerId: string } | { supplierId: string },
  from: Date,
  to: Date,
) {
  const ledger = { companyId, status: { in: [...LEDGER_STATUSES] as string[] } };
  // Balance brought forward: everything before the window.
  const opening = await db.journalLine.aggregate({
    where: { companyId, ...party, journalEntry: { ...ledger, entryDate: { lt: from } } },
    _sum: { debitBase: true, creditBase: true },
  });
  const openingBalance = new Dec(opening._sum.debitBase ?? 0).minus(opening._sum.creditBase ?? 0);

  const lines = await db.journalLine.findMany({
    where: { companyId, ...party, journalEntry: { ...ledger, entryDate: { gte: from, lte: to } } },
    select: {
      debitBase: true, creditBase: true,
      journalEntry: { select: { entryNo: true, entryDate: true, description: true } },
    },
    orderBy: [{ journalEntry: { entryDate: 'asc' } }, { journalEntry: { entryNo: 'asc' } }, { lineNo: 'asc' }],
  });

  let running = openingBalance;
  let totalDebit = new Dec(0);
  let totalCredit = new Dec(0);
  const rows: Record<string, unknown>[] = [{
    date: from, entry_no: null, description: 'Balance brought forward',
    debit: '0.00', credit: '0.00', balance: openingBalance.toFixed(2),
  }];
  for (const line of lines) {
    const debit = new Dec(line.debitBase);
    const credit = new Dec(line.creditBase);
    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
    running = running.plus(debit).minus(credit);
    rows.push({
      date: line.journalEntry.entryDate, entry_no: line.journalEntry.entryNo,
      description: line.journalEntry.description,
      debit: debit.toFixed(2), credit: credit.toFixed(2), balance: running.toFixed(2),
    });
  }
  return {
    rows,
    summary: {
      opening_balance: openingBalance.toFixed(2),
      total_debit: totalDebit.toFixed(2),
      total_credit: totalCredit.toFixed(2),
      closing_balance: running.toFixed(2),
    },
  };
}

export interface ReportResult {
  code: string;
  title: string;
  filters: Record<string, unknown>;
  columns: string[];
  rows: Record<string, unknown>[];
  summary?: Record<string, unknown>;
}

// Optional filter object accepted by reports that need parameters beyond companyId.
// The legacy reports (trial_balance, inventory_valuation, sales_summary, stock_alert,
// ar_aging, ap_aging) keep their original positional signatures for backwards
// compatibility with the [code] route dispatch.
export interface ReportFilters {
  fromDate?: Date;
  toDate?: Date;
  asOf?: Date;
  warehouseId?: string;
  branchId?: string;
  productId?: string;
  customerId?: string;
  supplierId?: string;
  serialNumber?: string;
  limit?: number;
}

// ── Trial Balance: the same computation as the trial-balance API ──
export async function reportTrialBalance(companyId: string, asOf?: Date): Promise<ReportResult> {
  const at = asOf ?? new Date();
  const report = await computeTrialBalance(db, companyId, at);
  const rows = report.accounts.map(account => ({
    code: account.code, name: account.name, account_class: account.account_class,
    debit: account.total_debit, credit: account.total_credit,
    // Signed on the account's normal side, as this report always showed it.
    balance: (account.balance_type === (account.normal_balance === 'D' ? 'Debit' : 'Credit') ? '' : '-') + account.balance,
  }));
  return { code: 'trial_balance', title: 'Trial Balance', filters: { as_of: at },
    columns: ['code', 'name', 'account_class', 'debit', 'credit', 'balance'], rows,
    summary: { ...report.summary } };
}

// ── Shared aggregates ──

/**
 * Inventory value over every stock row in scope: each row's value is rounded to
 * the cent, as the listed rows show it, so the listed values add up to the total.
 */
async function inventoryTotals(scope: ReportSqlScope, warehouseId?: string) {
  const [row] = await db.$queryRaw<Array<{ skus: bigint; total_value: Prisma.Decimal | null }>>`
    SELECT COUNT(*) AS skus, SUM(ROUND(ws.qty_on_hand * ws.moving_average_cost, 2)) AS total_value
    FROM warehouse_stocks ws
    JOIN warehouses w ON w.id = ws.warehouse_id AND w.company_id = ws.company_id
    WHERE ws.company_id = ${scope.companyId}
      ${warehouseId ? Prisma.sql`AND ws.warehouse_id = ${warehouseId}` : Prisma.empty}
      ${scope.branch('w.branch_id')}`;
  return { skus: count(row?.skus), totalValue: dec(row?.total_value) };
}

// Low stock: available (on hand less reserved) at or below the product's alert level.
function lowStockFrom(scope: ReportSqlScope) {
  return Prisma.sql`
    FROM warehouse_stocks ws
    JOIN products p ON p.id = ws.product_id AND p.company_id = ws.company_id
    JOIN warehouses w ON w.id = ws.warehouse_id AND w.company_id = ws.company_id
    WHERE ws.company_id = ${scope.companyId}
      AND ws.qty_on_hand - ws.qty_reserved <= p.alert_quantity
      ${scope.branch('w.branch_id')}`;
}

async function lowStockCount(scope: ReportSqlScope) {
  const [row] = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n ${lowStockFrom(scope)}`;
  return count(row?.n);
}

// Receivable per sale, from the records that move AR in the ledger:
//
//   grand total                               Dr AR    (PostSale)
//   - allocations of payments still posted    Cr AR    (a reversed payment's
//                                                       allocation no longer pays)
//   - credit of posted returns                Cr AR    (PostSaleReturn)
//   + refunds paid out against those returns  Dr AR    (sale_refund payments)
//
// Only balances above one paisa are outstanding, as before.
function receivableSql(scope: ReportSqlScope, now: Date) {
  return Prisma.sql`
    WITH paid AS (
      SELECT a.sale_id, SUM(a.allocated_amount) AS amount
      FROM payment_allocations a
      JOIN payments p ON p.id = a.payment_id AND p.company_id = a.company_id
      WHERE a.company_id = ${scope.companyId} AND a.sale_id IS NOT NULL AND p.payment_status = 'posted'
        ${scope.branch('p.branch_id')}
      GROUP BY a.sale_id
    ), returned AS (
      SELECT r.sale_id, SUM(r.total_credit) AS amount
      FROM sale_returns r
      WHERE r.company_id = ${scope.companyId} AND r.status = 'posted'
        ${scope.branch('r.branch_id')}
      GROUP BY r.sale_id
    ), refunded AS (
      SELECT r.sale_id, SUM(p.amount) AS amount
      FROM payments p
      JOIN sale_returns r ON r.id = p.sale_return_id AND r.company_id = p.company_id
      WHERE p.company_id = ${scope.companyId} AND p.payment_type = 'sale_refund'
        AND p.direction = 'outgoing' AND p.payment_status = 'posted' AND r.status = 'posted'
        ${scope.branch('p.branch_id')}
      GROUP BY r.sale_id
    ), due AS (
      SELECT s.id, s.reference_no, s.business_date, c.name AS customer_name,
             s.grand_total - COALESCE(paid.amount, 0) - COALESCE(returned.amount, 0) + COALESCE(refunded.amount, 0) AS amount_due,
             TIMESTAMPDIFF(DAY, s.business_date, ${now}) AS age_days
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id AND c.company_id = s.company_id
      LEFT JOIN paid ON paid.sale_id = s.id
      LEFT JOIN returned ON returned.sale_id = s.id
      LEFT JOIN refunded ON refunded.sale_id = s.id
      WHERE s.company_id = ${scope.companyId} AND s.sale_status IN (${Prisma.join(SALE_STATUSES)})
        ${scope.branch('s.branch_id')}
    )`;
}

// Payable per purchase. Purchase payments are posted against the AP control
// account but, today, nothing allocates them to a purchase (payment_allocations
// has a purchase_id column with no writer), so this is the order total less any
// allocation that does exist -- not an authoritative outstanding balance. The
// report says so, and carries the AP control balance from the ledger alongside.
function payableSql(scope: ReportSqlScope, now: Date) {
  return Prisma.sql`
    WITH paid AS (
      SELECT a.purchase_id, SUM(a.allocated_amount) AS amount
      FROM payment_allocations a
      JOIN payments p ON p.id = a.payment_id AND p.company_id = a.company_id
      WHERE a.company_id = ${scope.companyId} AND a.purchase_id IS NOT NULL AND p.payment_status = 'posted'
        ${scope.branch('p.branch_id')}
      GROUP BY a.purchase_id
    ), due AS (
      SELECT pu.id, pu.reference_no, pu.order_date, su.name AS supplier_name,
             pu.grand_total - COALESCE(paid.amount, 0) AS amount_due,
             TIMESTAMPDIFF(DAY, pu.order_date, ${now}) AS age_days
      FROM purchases pu
      JOIN suppliers su ON su.id = pu.supplier_id AND su.company_id = pu.company_id
      LEFT JOIN paid ON paid.purchase_id = pu.id
      WHERE pu.company_id = ${scope.companyId}
        ${scope.branch('pu.branch_id')}
    )`;
}

const BUCKET = Prisma.sql`CASE WHEN age_days <= 30 THEN '0-30' WHEN age_days <= 60 THEN '31-60' WHEN age_days <= 90 THEN '61-90' ELSE '90+' END`;

async function agingTotals(dueSql: Prisma.Sql) {
  const rows = await db.$queryRaw<Array<{ bucket: string; n: bigint; amount: Prisma.Decimal | null }>>`
    ${dueSql}
    SELECT ${BUCKET} AS bucket, COUNT(*) AS n, SUM(amount_due) AS amount
    FROM due WHERE amount_due > 0.01 GROUP BY bucket`;
  const buckets: Record<string, string> = { '0-30': '0.00', '31-60': '0.00', '61-90': '0.00', '90+': '0.00' };
  let total = new Dec(0);
  let documents = 0;
  for (const row of rows) {
    buckets[row.bucket] = dec(row.amount).toFixed(2);
    total = total.plus(dec(row.amount));
    documents += count(row.n);
  }
  return { total, documents, buckets };
}

// ── Inventory Valuation ──
export async function reportInventoryValuation(companyId: string, warehouseId?: string): Promise<ReportResult> {
  const scope = reportSqlScope(companyId);
  const [totals, stocks] = await Promise.all([
    inventoryTotals(scope, warehouseId),
    db.warehouseStock.findMany({
      where: { companyId, ...(warehouseId ? { warehouseId } : {}) },
      include: { product: { select: { code: true, name: true } }, warehouse: { select: { code: true, name: true } } },
      orderBy: [{ warehouseId: 'asc' }, { productId: 'asc' }],
      take: DETAIL_LIMIT,
    }),
  ]);
  const rows = stocks.map(s => ({
    warehouse: s.warehouse.name, product_code: s.product.code, product_name: s.product.name,
    qty_on_hand: s.qtyOnHand.toString(), moving_average_cost: s.movingAverageCost.toString(),
    inventory_value: s.qtyOnHand.mul(s.movingAverageCost).toFixed(2),
  }));
  return { code: 'inventory_valuation', title: 'Inventory Valuation', filters: { warehouse_id: warehouseId ?? 'all' },
    columns: ['warehouse', 'product_code', 'product_name', 'qty_on_hand', 'moving_average_cost', 'inventory_value'],
    rows, summary: { total_value: totals.totalValue.toFixed(2), total_skus: totals.skus, ...detailMeta(rows.length, totals.skus) } };
}

// ── Sales Summary ──
export async function reportSalesSummary(companyId: string, fromDate: Date, toDate: Date): Promise<ReportResult> {
  const where = { companyId, businessDate: { gte: fromDate, lte: toDate }, saleStatus: { in: SALE_STATUSES } };
  const [totals, sales] = await Promise.all([
    db.sale.aggregate({ where, _count: { _all: true }, _sum: { grandTotal: true } }),
    db.sale.findMany({
      where,
      select: { id: true, referenceNo: true, grandTotal: true, businessDate: true, saleStatus: true, _count: { select: { items: true } } },
      orderBy: [{ businessDate: 'asc' }, { id: 'asc' }],
      take: DETAIL_LIMIT,
    }),
  ]);
  const rows = sales.map(s => ({
    reference_no: s.referenceNo, date: s.businessDate, status: s.saleStatus,
    grand_total: s.grandTotal.toString(), item_count: s._count.items,
  }));
  return { code: 'sales_summary', title: 'Sales Summary', filters: { from: fromDate, to: toDate },
    columns: ['reference_no', 'date', 'status', 'grand_total', 'item_count'],
    rows, summary: { total_sales: totals._count._all, total_revenue: dec(totals._sum.grandTotal).toFixed(2), ...detailMeta(rows.length, totals._count._all) } };
}

// ── Stock Alert (low stock) ──
export async function reportStockAlert(companyId: string): Promise<ReportResult> {
  const scope = reportSqlScope(companyId);
  const [total, stocks] = await Promise.all([
    lowStockCount(scope),
    db.$queryRaw<Array<{ warehouse: string; product_code: string; product_name: string; qty_on_hand: Prisma.Decimal; qty_reserved: Prisma.Decimal; alert_quantity: Prisma.Decimal }>>`
      SELECT w.name AS warehouse, p.code AS product_code, p.name AS product_name,
             ws.qty_on_hand, ws.qty_reserved, p.alert_quantity
      ${lowStockFrom(scope)}
      ORDER BY w.name, p.code, ws.id
      LIMIT ${DETAIL_LIMIT}`,
  ]);
  const rows = stocks.map(s => ({
    warehouse: s.warehouse, product_code: s.product_code, product_name: s.product_name,
    qty_on_hand: dec(s.qty_on_hand).toString(), qty_reserved: dec(s.qty_reserved).toString(),
    qty_available: dec(s.qty_on_hand).minus(dec(s.qty_reserved)).toFixed(4),
    alert_quantity: dec(s.alert_quantity).toString(),
  }));
  return { code: 'stock_alert', title: 'Low Stock Alert', filters: {},
    columns: ['warehouse', 'product_code', 'product_name', 'qty_on_hand', 'qty_reserved', 'qty_available', 'alert_quantity'],
    rows, summary: { low_stock_count: total, ...detailMeta(rows.length, total) } };
}

// ── AR Aging ──
export async function reportArAging(companyId: string): Promise<ReportResult> {
  const scope = reportSqlScope(companyId);
  const now = new Date();
  const dueSql = receivableSql(scope, now);
  const [totals, due, ledger] = await Promise.all([
    agingTotals(dueSql),
    db.$queryRaw<Array<{ reference_no: string; customer_name: string | null; business_date: Date; amount_due: Prisma.Decimal; age_days: bigint }>>`
      ${dueSql}
      SELECT reference_no, customer_name, business_date, amount_due, age_days
      FROM due WHERE amount_due > 0.01
      ORDER BY business_date, reference_no
      LIMIT ${DETAIL_LIMIT}`,
    controlAccountBalance(companyId, 'arAccountId'),
  ]);
  const rows = due.map(s => {
    const ageDays = count(s.age_days);
    return { reference_no: s.reference_no, customer: s.customer_name ?? 'Walk-in',
      sale_date: s.business_date, amount_due: dec(s.amount_due).toFixed(2), age_days: ageDays,
      bucket: ageDays <= 30 ? '0-30' : ageDays <= 60 ? '31-60' : ageDays <= 90 ? '61-90' : '90+' };
  });
  return { code: 'ar_aging', title: 'AR Aging', filters: {},
    columns: ['reference_no', 'customer', 'sale_date', 'amount_due', 'age_days', 'bucket'], rows,
    summary: { total_due: totals.total.toFixed(2), outstanding_documents: totals.documents, buckets: totals.buckets,
      ledger_ar_balance: ledger, ...detailMeta(rows.length, totals.documents) } };
}

// ── AP Aging ──
export async function reportApAging(companyId: string): Promise<ReportResult> {
  const scope = reportSqlScope(companyId);
  const now = new Date();
  const dueSql = payableSql(scope, now);
  const [totals, due, ledger] = await Promise.all([
    agingTotals(dueSql),
    db.$queryRaw<Array<{ reference_no: string; supplier_name: string; order_date: Date; amount_due: Prisma.Decimal; age_days: bigint }>>`
      ${dueSql}
      SELECT reference_no, supplier_name, order_date, amount_due, age_days
      FROM due WHERE amount_due > 0.01
      ORDER BY order_date, reference_no
      LIMIT ${DETAIL_LIMIT}`,
    controlAccountBalance(companyId, 'apAccountId'),
  ]);
  const rows = due.map(p => {
    const ageDays = count(p.age_days);
    return { reference_no: p.reference_no, supplier: p.supplier_name,
      order_date: p.order_date, amount_due: dec(p.amount_due).toFixed(2), age_days: ageDays,
      bucket: ageDays <= 30 ? '0-30' : ageDays <= 60 ? '31-60' : ageDays <= 90 ? '61-90' : '90+' };
  });
  return { code: 'ap_aging', title: 'AP Aging', filters: {},
    columns: ['reference_no', 'supplier', 'order_date', 'amount_due', 'age_days', 'bucket'], rows,
    summary: { total_due: totals.total.toFixed(2), outstanding_documents: totals.documents, buckets: totals.buckets,
      amount_basis: 'purchase_total_less_allocated_payments', authoritative: false,
      limitation: 'Purchase payments are not allocated to purchases, so per-purchase amounts are order totals, not balances owed. ledger_ap_balance is the authoritative payable.',
      ledger_ap_balance: ledger, ...detailMeta(rows.length, totals.documents) } };
}

// ════════════════════════════════════════════════════════════════════════
// §11.5 — Additional reports (P3A-Reports)
// Each function takes (companyId, filters?) and returns a ReportResult.
// Empty/missing filters → graceful empty rows, never errors.
// ════════════════════════════════════════════════════════════════════════

// 1. dashboard_summary — KPIs for the operator landing card.
export async function reportDashboardSummary(companyId: string): Promise<ReportResult> {
  const scope = reportSqlScope(companyId);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const [salesAgg, ar, approvals, shifts, lowStock] = await Promise.all([
    db.sale.aggregate({ _sum: { grandTotal: true }, where: { companyId, businessDate: { gte: today, lt: tomorrow }, saleStatus: { in: SALE_STATUSES } } }),
    agingTotals(receivableSql(scope, new Date())),
    db.approvalRequest.count({ where: { companyId, status: 'pending' } }),
    db.cashierShift.count({ where: { companyId, status: 'open' } }),
    lowStockCount(scope),
  ]);
  const todaySales = dec(salesAgg._sum.grandTotal).toFixed(2);
  const arOutstanding = ar.total.toFixed(2);
  const rows = [
    { metric: 'today_sales_total', value: todaySales },
    { metric: 'low_stock_count', value: String(lowStock) },
    { metric: 'ar_outstanding', value: arOutstanding },
    { metric: 'pending_approvals', value: String(approvals) },
    { metric: 'active_shifts', value: String(shifts) },
  ];
  return { code: 'dashboard_summary', title: 'Dashboard Summary', filters: { as_of: new Date() },
    columns: ['metric', 'value'], rows,
    summary: { today_sales_total: todaySales, low_stock_count: lowStock, ar_outstanding: arOutstanding, pending_approvals: approvals, active_shifts: shifts } };
}

// 2. profit_and_loss — Revenue − COGS − Expenses = Net Profit, by GL account.
export async function reportProfitAndLoss(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const totals = (await accountTotals(companyId, { gte: from, lte: to }))
    .filter(account => account.accountClass === 'revenue' || account.accountClass === 'expense');

  let revenue = new Dec(0);
  let expense = new Dec(0);
  const rows = totals.map(account => {
    const balance = account.accountClass === 'revenue'
      ? account.credit.minus(account.debit)
      : account.debit.minus(account.credit);
    if (account.accountClass === 'revenue') revenue = revenue.plus(balance);
    else expense = expense.plus(balance);
    return {
      account_class: account.accountClass, code: account.code, name: account.name,
      debit: account.debit.toFixed(2), credit: account.credit.toFixed(2), balance: balance.toFixed(2),
    };
  }).sort((x, y) => x.code.localeCompare(y.code));

  return { code: 'profit_and_loss', title: 'Profit & Loss', filters: { from, to },
    columns: ['account_class', 'code', 'name', 'debit', 'credit', 'balance'], rows,
    summary: { total_revenue: revenue.toFixed(2), total_expense: expense.toFixed(2), net_profit: revenue.minus(expense).toFixed(2) } };
}

// 3. balance_sheet — Assets, Liabilities, Equity as of a date.
//
// Revenue and expense accounts are not closed into equity until year end, so
// without them a balance sheet cannot balance. Their net is shown as current
// earnings within equity, and the report states whether A = L + E exactly.
export async function reportBalanceSheet(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const asOf = filters.asOf ?? new Date();
  const all = await accountTotals(companyId, { lte: asOf });

  const totals = { asset: new Dec(0), liability: new Dec(0), equity: new Dec(0) };
  let currentEarnings = new Dec(0);
  const rows: Record<string, unknown>[] = [];
  for (const account of all) {
    if (account.accountClass === 'revenue') { currentEarnings = currentEarnings.plus(account.credit.minus(account.debit)); continue; }
    if (account.accountClass === 'expense') { currentEarnings = currentEarnings.minus(account.debit.minus(account.credit)); continue; }
    if (account.accountClass !== 'asset' && account.accountClass !== 'liability' && account.accountClass !== 'equity') continue;
    const balance = account.normalBalance === 'D' ? account.debit.minus(account.credit) : account.credit.minus(account.debit);
    totals[account.accountClass] = totals[account.accountClass].plus(balance);
    rows.push({ account_class: account.accountClass, code: account.code, name: account.name, balance: balance.toFixed(2) });
  }
  rows.sort((x, y) => (x.code as string).localeCompare(y.code as string));
  rows.push({ account_class: 'equity', code: null, name: 'Current period earnings (unclosed)', balance: currentEarnings.toFixed(2) });

  const equity = totals.equity.plus(currentEarnings);
  const difference = totals.asset.minus(totals.liability.plus(equity));
  return { code: 'balance_sheet', title: 'Balance Sheet', filters: { as_of: asOf },
    columns: ['account_class', 'code', 'name', 'balance'], rows,
    summary: {
      total_assets: totals.asset.toFixed(2), total_liabilities: totals.liability.toFixed(2),
      total_equity: equity.toFixed(2), current_period_earnings: currentEarnings.toFixed(2),
      difference: difference.toFixed(2), is_balanced: difference.isZero(),
    } };
}

// 4. cash_flow — Cash in/out bucketed into operating / investing / financing
//    using the offsetting account class of each cash-account journal line.
//
// Classification needs every line of an entry, so this walks the ledger in
// bounded pages rather than aggregating in SQL. It used to read the first 5,000
// entries (and 1,000 lines of each), count only status 'posted' -- a reversal
// without its reversed original -- and sum with parseFloat. The walk now covers
// every entry in the window, in Decimal, with the ledger's statuses; only the
// listed rows are capped.
const CASH_FLOW_PAGE = 500;

export async function reportCashFlow(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const cashAccounts = await db.financialAccount.findMany({ where: { companyId, accountType: { in: ['cash', 'bank', 'mobile_wallet'] } }, select: { id: true } });
  const cashAccountIds = new Set(cashAccounts.map(a => a.id));
  if (cashAccountIds.size === 0) return { code: 'cash_flow', title: 'Cash Flow Statement', filters: { from, to }, columns: ['date', 'entry_no', 'category', 'description', 'direction', 'amount'], rows: [], summary: { operating_net: '0.00', investing_net: '0.00', financing_net: '0.00', net_change: '0.00', ...detailMeta(0, 0) } };

  const cat = { operating: new Dec(0), investing: new Dec(0), financing: new Dec(0) };
  const rows: Record<string, unknown>[] = [];
  let cashLines = 0;
  let cursor: string | undefined;
  for (;;) {
    const entries = await db.journalEntry.findMany({
      where: { companyId, status: { in: [...LEDGER_STATUSES] }, entryDate: { gte: from, lte: to } },
      include: { lines: { include: { chartOfAccount: { select: { accountClass: true, accountSubtype: true } }, financialAccount: { select: { id: true } } } } },
      orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
      take: CASH_FLOW_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const je of entries) {
      for (const cl of je.lines) {
        if (!cl.financialAccount || !cashAccountIds.has(cl.financialAccount.id)) continue;
        const net = new Dec(cl.debitBase).minus(cl.creditBase);
        let category: keyof typeof cat = 'operating';
        for (const ol of je.lines) {
          if (ol.id === cl.id) continue;
          const cls = ol.chartOfAccount.accountClass;
          const sub = ol.chartOfAccount.accountSubtype ?? '';
          if (cls === 'asset' && (sub.includes('fixed') || sub.includes('non_current') || sub.includes('capital'))) category = 'investing';
          else if (cls === 'equity' || (cls === 'liability' && (sub.includes('long_term') || sub.includes('loan')))) category = 'financing';
        }
        cat[category] = cat[category].plus(net);
        cashLines += 1;
        if (rows.length < DETAIL_LIMIT) {
          rows.push({ date: je.entryDate, entry_no: je.entryNo, category, description: je.description, direction: net.gte(0) ? 'in' : 'out', amount: net.abs().toFixed(2) });
        }
      }
    }
    if (entries.length < CASH_FLOW_PAGE) break;
    cursor = entries[entries.length - 1].id;
  }
  return { code: 'cash_flow', title: 'Cash Flow Statement', filters: { from, to },
    columns: ['date', 'entry_no', 'category', 'description', 'direction', 'amount'], rows,
    summary: { operating_net: cat.operating.toFixed(2), investing_net: cat.investing.toFixed(2), financing_net: cat.financing.toFixed(2),
      net_change: cat.operating.plus(cat.investing).plus(cat.financing).toFixed(2), ...detailMeta(rows.length, cashLines) } };
}

// Sales and purchases per day or month. Grouped in the database on the UTC
// calendar date, which is what `toISOString().slice(...)` grouped on before.
async function periodTotals(
  scope: ReportSqlScope, table: 'sales' | 'purchases', unit: 'day' | 'month', from: Date, to: Date,
) {
  const format = unit === 'day' ? '%Y-%m-%d' : '%Y-%m';
  const query = table === 'sales'
    ? Prisma.sql`
        SELECT DATE_FORMAT(t.business_date, ${format}) AS period, COUNT(*) AS n,
               SUM(t.grand_total) AS total, SUM(t.base_grand_total) AS base_total
        FROM sales t
        WHERE t.company_id = ${scope.companyId} AND t.business_date BETWEEN ${from} AND ${to}
          AND t.sale_status IN (${Prisma.join(SALE_STATUSES)}) ${scope.branch('t.branch_id')}
        GROUP BY period ORDER BY period`
    : Prisma.sql`
        SELECT DATE_FORMAT(t.order_date, ${format}) AS period, COUNT(*) AS n,
               SUM(t.grand_total) AS total, SUM(t.base_grand_total) AS base_total
        FROM purchases t
        WHERE t.company_id = ${scope.companyId} AND t.order_date BETWEEN ${from} AND ${to}
          ${scope.branch('t.branch_id')}
        GROUP BY period ORDER BY period`;
  const grouped = await db.$queryRaw<Array<{ period: string; n: bigint; total: Prisma.Decimal | null; base_total: Prisma.Decimal | null }>>(query);
  let documents = 0;
  let amount = new Dec(0);
  const rows = grouped.map(row => {
    documents += count(row.n);
    amount = amount.plus(dec(row.total));
    return { period: row.period, count: count(row.n), total: dec(row.total).toFixed(2), base_total: dec(row.base_total).toFixed(2) };
  });
  return { rows, documents, amount: amount.toFixed(2) };
}

// 5. daily_sales — sales grouped by business date.
export async function reportDailySales(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const totals = await periodTotals(reportSqlScope(companyId), 'sales', 'day', from, to);
  const rows = totals.rows.map(r => ({ day: r.period, sale_count: r.count, total: r.total, base_total: r.base_total }));
  return { code: 'daily_sales', title: 'Daily Sales', filters: { from, to },
    columns: ['day', 'sale_count', 'total', 'base_total'], rows,
    summary: { total_sales: totals.documents, total_amount: totals.amount } };
}

// 6. monthly_sales — sales grouped by YYYY-MM.
export async function reportMonthlySales(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const totals = await periodTotals(reportSqlScope(companyId), 'sales', 'month', from, to);
  const rows = totals.rows.map(r => ({ month: r.period, sale_count: r.count, total: r.total, base_total: r.base_total }));
  return { code: 'monthly_sales', title: 'Monthly Sales', filters: { from, to },
    columns: ['month', 'sale_count', 'total', 'base_total'], rows,
    summary: { total_sales: totals.documents, total_amount: totals.amount } };
}

// 7. daily_purchases — purchases grouped by order date.
export async function reportDailyPurchases(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const totals = await periodTotals(reportSqlScope(companyId), 'purchases', 'day', from, to);
  const rows = totals.rows.map(r => ({ day: r.period, purchase_count: r.count, total: r.total, base_total: r.base_total }));
  return { code: 'daily_purchases', title: 'Daily Purchases', filters: { from, to },
    columns: ['day', 'purchase_count', 'total', 'base_total'], rows,
    summary: { total_purchases: totals.documents, total_amount: totals.amount } };
}

// 8. monthly_purchases — purchases grouped by YYYY-MM.
export async function reportMonthlyPurchases(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const totals = await periodTotals(reportSqlScope(companyId), 'purchases', 'month', from, to);
  const rows = totals.rows.map(r => ({ month: r.period, purchase_count: r.count, total: r.total, base_total: r.base_total }));
  return { code: 'monthly_purchases', title: 'Monthly Purchases', filters: { from, to },
    columns: ['month', 'purchase_count', 'total', 'base_total'], rows,
    summary: { total_purchases: totals.documents, total_amount: totals.amount } };
}

// 9. customer_ledger — every ledger line for a customer, from the balance brought forward.
export async function reportCustomerLedger(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const columns = ['date', 'entry_no', 'description', 'debit', 'credit', 'balance'];
  if (!filters.customerId) return { code: 'customer_ledger', title: 'Customer Ledger', filters: { customer_id: null, from, to }, columns, rows: [], summary: { opening_balance: '0.00', total_debit: '0.00', total_credit: '0.00', closing_balance: '0.00' } };
  const ledger = await partyLedger(companyId, { customerId: filters.customerId }, from, to);
  return { code: 'customer_ledger', title: 'Customer Ledger', filters: { customer_id: filters.customerId, from, to },
    columns, rows: ledger.rows, summary: ledger.summary };
}

// 10. supplier_ledger — every ledger line for a supplier, from the balance brought forward.
export async function reportSupplierLedger(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const columns = ['date', 'entry_no', 'description', 'debit', 'credit', 'balance'];
  if (!filters.supplierId) return { code: 'supplier_ledger', title: 'Supplier Ledger', filters: { supplier_id: null, from, to }, columns, rows: [], summary: { opening_balance: '0.00', total_debit: '0.00', total_credit: '0.00', closing_balance: '0.00' } };
  const ledger = await partyLedger(companyId, { supplierId: filters.supplierId }, from, to);
  return { code: 'supplier_ledger', title: 'Supplier Ledger', filters: { supplier_id: filters.supplierId, from, to },
    columns, rows: ledger.rows, summary: ledger.summary };
}

// 11. expense_report — expenses grouped by category.
export async function reportExpenseReport(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const grouped = await db.expenseItem.groupBy({
    by: ['expenseCategoryId'],
    where: { companyId, expense: { expenseDate: { gte: from, lte: to }, status: 'posted' } },
    _count: { _all: true },
    _sum: { amount: true, taxAmount: true },
  });
  const categories = grouped.length === 0 ? [] : await db.expenseCategory.findMany({
    where: { companyId, id: { in: grouped.map(g => g.expenseCategoryId) } }, select: { id: true, name: true },
  });
  const names = new Map(categories.map(c => [c.id, c.name]));
  let totalAmount = new Dec(0);
  let totalTax = new Dec(0);
  const rows = grouped.map(g => {
    const amount = dec(g._sum.amount);
    const tax = dec(g._sum.taxAmount);
    totalAmount = totalAmount.plus(amount);
    totalTax = totalTax.plus(tax);
    return { category_id: g.expenseCategoryId, category: names.get(g.expenseCategoryId) ?? null, expense_count: g._count._all,
      amount: amount.toFixed(2), tax: tax.toFixed(2), total: amount.plus(tax).toFixed(2), sortKey: amount.plus(tax) };
  }).sort((a, b) => b.sortKey.comparedTo(a.sortKey)).map(({ sortKey: _sortKey, ...row }) => row);
  return { code: 'expense_report', title: 'Expense Report', filters: { from, to },
    columns: ['category_id', 'category', 'expense_count', 'amount', 'tax', 'total'], rows,
    summary: { total_amount: totalAmount.toFixed(2), total_tax: totalTax.toFixed(2) } };
}

// 12. tax_summary — VAT output (sales) vs VAT input (purchases) by tax component code.
export async function reportTaxSummary(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const [saleTaxes, purchTaxes] = await Promise.all([
    db.saleItemTax.groupBy({ by: ['componentCodeSnapshot'], where: { companyId, saleItem: { sale: { businessDate: { gte: from, lte: to }, saleStatus: { in: SALE_STATUSES } } } }, _sum: { taxAmount: true, taxableBase: true } }),
    db.purchaseItemTax.groupBy({ by: ['componentCodeSnapshot'], where: { companyId, purchaseItem: { purchase: { orderDate: { gte: from, lte: to } } } }, _sum: { taxAmount: true, taxableBase: true, recoverableAmount: true } }),
  ]);
  const zero = () => ({ output_tax: new Dec(0), input_tax: new Dec(0), output_base: new Dec(0), input_base: new Dec(0), recoverable: new Dec(0) });
  const byCode = new Map<string, ReturnType<typeof zero>>();
  const ensure = (code: string) => { if (!byCode.has(code)) byCode.set(code, zero()); return byCode.get(code)!; };
  for (const t of saleTaxes) { const c = ensure(t.componentCodeSnapshot); c.output_tax = dec(t._sum.taxAmount); c.output_base = dec(t._sum.taxableBase); }
  for (const t of purchTaxes) { const c = ensure(t.componentCodeSnapshot); c.input_tax = dec(t._sum.taxAmount); c.input_base = dec(t._sum.taxableBase); c.recoverable = dec(t._sum.recoverableAmount); }
  const total = { output: new Dec(0), input: new Dec(0), net: new Dec(0) };
  const rows = Array.from(byCode.entries()).map(([code, c]) => {
    const net = c.output_tax.minus(c.recoverable);
    total.output = total.output.plus(c.output_tax); total.input = total.input.plus(c.input_tax); total.net = total.net.plus(net);
    return { tax_code: code, output_base: c.output_base.toFixed(2), output_tax: c.output_tax.toFixed(2), input_base: c.input_base.toFixed(2), input_tax: c.input_tax.toFixed(2), recoverable: c.recoverable.toFixed(2), net_payable: net.toFixed(2) };
  }).sort((a, b) => a.tax_code.localeCompare(b.tax_code));
  return { code: 'tax_summary', title: 'Tax Summary', filters: { from, to },
    columns: ['tax_code', 'output_base', 'output_tax', 'input_base', 'input_tax', 'recoverable', 'net_payable'], rows,
    summary: { total_output_tax: total.output.toFixed(2), total_input_tax: total.input.toFixed(2), net_payable: total.net.toFixed(2) } };
}

// 13. best_seller — top N products by sales quantity (and amount).
//
// Ranked in the database over every qualifying line. The summary totals the
// listed top N, as it always did.
export async function reportBestSeller(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const top = Number.isInteger(filters.limit) && filters.limit! > 0 ? Math.min(filters.limit!, 1000) : 20;
  const where = { companyId, sale: { businessDate: { gte: from, lte: to }, saleStatus: { in: SALE_STATUSES } } };
  const ranked = await db.saleItem.groupBy({
    by: ['productId'], where,
    _sum: { qty: true, lineTotal: true },
    orderBy: [{ _sum: { qty: 'desc' } }, { productId: 'asc' }],
    take: top,
  });
  // The name and code as sold, from one qualifying line of each product.
  const snapshots = ranked.length === 0 ? [] : await db.saleItem.findMany({
    where: { ...where, productId: { in: ranked.map(r => r.productId) } },
    distinct: ['productId'],
    select: { productId: true, productCodeSnapshot: true, productNameSnapshot: true },
  });
  const byId = new Map(snapshots.map(s => [s.productId, s]));
  let totalQty = new Dec(0);
  let totalAmount = new Dec(0);
  const rows = ranked.map(r => {
    const qty = dec(r._sum.qty);
    const amount = dec(r._sum.lineTotal);
    totalQty = totalQty.plus(qty);
    totalAmount = totalAmount.plus(amount);
    const snapshot = byId.get(r.productId);
    return { product_id: r.productId, product_code: snapshot?.productCodeSnapshot ?? null, product_name: snapshot?.productNameSnapshot ?? null,
      qty_sold: qty.toFixed(4), sales_amount: amount.toFixed(2) };
  });
  return { code: 'best_seller', title: 'Best Sellers', filters: { from, to, top_n: top },
    columns: ['product_id', 'product_code', 'product_name', 'qty_sold', 'sales_amount'], rows,
    summary: { total_qty: totalQty.toFixed(4), total_amount: totalAmount.toFixed(2) } };
}

// 14. product_inventory — detailed inventory with last movement timestamp.
//
// It read every stock row with no limit, but only the newest 10,000 movements
// of the whole company, so most rows past a few weeks of trading showed no last
// movement. Each listed row now looks up its own latest movement.
export async function reportProductInventory(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const scope = reportSqlScope(companyId);
  const warehouse = filters.warehouseId ? Prisma.sql`AND ws.warehouse_id = ${filters.warehouseId}` : Prisma.empty;
  const [totals, stocks] = await Promise.all([
    inventoryTotals(scope, filters.warehouseId),
    db.$queryRaw<Array<{ warehouse: string; product_code: string; product_name: string; qty_on_hand: Prisma.Decimal; qty_reserved: Prisma.Decimal; moving_average_cost: Prisma.Decimal; last_movement_at: Date | null; last_movement_type: string | null }>>`
      SELECT w.name AS warehouse, p.code AS product_code, p.name AS product_name,
             ws.qty_on_hand, ws.qty_reserved, ws.moving_average_cost,
             (SELECT m.effective_at FROM stock_movements m
               WHERE m.company_id = ws.company_id AND m.product_id = ws.product_id AND m.warehouse_id = ws.warehouse_id
               ORDER BY m.effective_at DESC, m.id DESC LIMIT 1) AS last_movement_at,
             (SELECT m.movement_type FROM stock_movements m
               WHERE m.company_id = ws.company_id AND m.product_id = ws.product_id AND m.warehouse_id = ws.warehouse_id
               ORDER BY m.effective_at DESC, m.id DESC LIMIT 1) AS last_movement_type
      FROM warehouse_stocks ws
      JOIN products p ON p.id = ws.product_id AND p.company_id = ws.company_id
      JOIN warehouses w ON w.id = ws.warehouse_id AND w.company_id = ws.company_id
      WHERE ws.company_id = ${companyId} ${warehouse} ${scope.branch('w.branch_id')}
      ORDER BY w.name, p.code, ws.id
      LIMIT ${DETAIL_LIMIT}`,
  ]);
  const rows = stocks.map(s => ({
    warehouse: s.warehouse, product_code: s.product_code, product_name: s.product_name,
    qty_on_hand: dec(s.qty_on_hand).toString(), qty_reserved: dec(s.qty_reserved).toString(),
    moving_average_cost: dec(s.moving_average_cost).toString(),
    inventory_value: dec(s.qty_on_hand).mul(dec(s.moving_average_cost)).toFixed(2),
    last_movement_at: s.last_movement_at, last_movement_type: s.last_movement_type,
  }));
  return { code: 'product_inventory', title: 'Product Inventory', filters: { warehouse_id: filters.warehouseId ?? 'all' },
    columns: ['warehouse', 'product_code', 'product_name', 'qty_on_hand', 'qty_reserved', 'moving_average_cost', 'inventory_value', 'last_movement_at', 'last_movement_type'], rows,
    summary: { total_skus: totals.skus, total_value: totals.totalValue.toFixed(2), ...detailMeta(rows.length, totals.skus) } };
}

// 15. inventory_ledger — stock movements for a product/warehouse over time.
//
// The running quantity starts at zero on `from`: it is the movement within the
// window, not the stock level.
export async function reportInventoryLedger(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  if (!filters.productId) return { code: 'inventory_ledger', title: 'Inventory Ledger', filters: { product_id: null, from, to }, columns: ['date', 'movement_type', 'reference_type', 'reference_id', 'qty_delta', 'unit_cost', 'total_cost_delta'], rows: [], summary: { net_qty_delta: '0.0000' } };
  const where = { companyId, productId: filters.productId, effectiveAt: { gte: from, lte: to }, ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}) };
  const [totals, movements] = await Promise.all([
    db.stockMovement.aggregate({ where, _count: { _all: true }, _sum: { qtyDelta: true } }),
    db.stockMovement.findMany({
      where,
      orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
      include: { warehouse: { select: { name: true } } },
      take: DETAIL_LIMIT,
    }),
  ]);
  let running = new Dec(0);
  const rows = movements.map(m => {
    running = running.plus(m.qtyDelta);
    return { date: m.effectiveAt, warehouse: m.warehouse.name, movement_type: m.movementType, reference_type: m.referenceType, reference_id: m.referenceId, qty_delta: m.qtyDelta.toFixed(4), unit_cost: m.unitCost.toString(), total_cost_delta: m.totalCostDelta.toString(), running_qty: running.toFixed(4) };
  });
  return { code: 'inventory_ledger', title: 'Inventory Ledger', filters: { product_id: filters.productId, warehouse_id: filters.warehouseId ?? 'all', from, to },
    columns: ['date', 'warehouse', 'movement_type', 'reference_type', 'reference_id', 'qty_delta', 'unit_cost', 'total_cost_delta', 'running_qty'], rows,
    summary: { net_qty_delta: dec(totals._sum.qtyDelta).toFixed(4), movement_count: totals._count._all, ...detailMeta(rows.length, totals._count._all) } };
}

// 16. serial_history — full lifecycle of a serial number.
export async function reportSerialHistory(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  if (!filters.serialNumber) return { code: 'serial_history', title: 'Serial History', filters: { serial_number: null }, columns: ['occurred_at', 'event_type', 'from_status', 'to_status', 'from_warehouse', 'to_warehouse', 'reference_type', 'reference_id'], rows: [], summary: { event_count: 0 } };
  const serial = await db.productSerial.findFirst({ where: { companyId, serialNumber: filters.serialNumber }, include: { product: { select: { code: true, name: true } } } });
  if (!serial) return { code: 'serial_history', title: 'Serial History', filters: { serial_number: filters.serialNumber }, columns: ['occurred_at', 'event_type', 'from_status', 'to_status', 'from_warehouse', 'to_warehouse', 'reference_type', 'reference_id'], rows: [], summary: { event_count: 0 } };
  const events = await db.serialEvent.findMany({ where: { companyId, serialId: serial.id }, orderBy: { occurredAt: 'asc' }, include: { fromWarehouse: { select: { name: true } }, toWarehouse: { select: { name: true } } } });
  const rows = events.map(e => ({ occurred_at: e.occurredAt, event_type: e.eventType, from_status: e.fromStatus, to_status: e.toStatus, from_warehouse: e.fromWarehouse?.name ?? null, to_warehouse: e.toWarehouse?.name ?? null, reference_type: e.referenceType, reference_id: e.referenceId }));
  return { code: 'serial_history', title: 'Serial History', filters: { serial_number: filters.serialNumber },
    columns: ['occurred_at', 'event_type', 'from_status', 'to_status', 'from_warehouse', 'to_warehouse', 'reference_type', 'reference_id'], rows,
    summary: { product_code: serial.product.code, product_name: serial.product.name, current_status: serial.status, event_count: rows.length } };
}

// 17. stock_count_variance — variance summary from posted stock counts.
//
// A line's variance is its recorded variance, or counted less expected where
// none was recorded; the total is summed the same way over every counted line.
export async function reportStockCountVariance(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const where = { companyId, countedQuantity: { not: null }, ...(filters.warehouseId ? { stockCount: { warehouseId: filters.warehouseId } } : {}) };
  const [recorded, derived, items] = await Promise.all([
    db.stockCountItem.aggregate({ where: { ...where, varianceQuantity: { not: null } }, _count: { _all: true }, _sum: { varianceQuantity: true } }),
    db.stockCountItem.aggregate({ where: { ...where, varianceQuantity: null }, _count: { _all: true }, _sum: { countedQuantity: true, expectedQuantity: true } }),
    db.stockCountItem.findMany({
      where,
      include: { product: { select: { code: true, name: true } }, stockCount: { select: { referenceNo: true, postedAt: true, warehouse: { select: { name: true } } } } },
      orderBy: [{ stockCount: { referenceNo: 'asc' } }, { id: 'asc' }],
      take: DETAIL_LIMIT,
    }),
  ]);
  const rows = items.map(i => {
    const expected = new Dec(i.expectedQuantity);
    const counted = dec(i.countedQuantity);
    const variance = i.varianceQuantity ? new Dec(i.varianceQuantity) : counted.minus(expected);
    return { count_ref: i.stockCount.referenceNo, posted_at: i.stockCount.postedAt, warehouse: i.stockCount.warehouse.name, product_code: i.product.code, product_name: i.product.name, expected: expected.toFixed(4), counted: counted.toFixed(4), variance: variance.toFixed(4) };
  });
  const totalItems = recorded._count._all + derived._count._all;
  const totalVariance = dec(recorded._sum.varianceQuantity).plus(dec(derived._sum.countedQuantity)).minus(dec(derived._sum.expectedQuantity));
  return { code: 'stock_count_variance', title: 'Stock Count Variance', filters: { warehouse_id: filters.warehouseId ?? 'all' },
    columns: ['count_ref', 'posted_at', 'warehouse', 'product_code', 'product_name', 'expected', 'counted', 'variance'], rows,
    summary: { total_items: totalItems, total_variance: totalVariance.toFixed(4), ...detailMeta(rows.length, totalItems) } };
}

// 18. batch_expiry — batches nearing expiry (FEFO ordering).
export async function reportBatchExpiry(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const daysAhead = filters.limit ?? 30;
  const now = new Date();
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + daysAhead);
  const batches = await db.productBatch.findMany({
    where: { companyId, status: 'active', expiryDate: { gte: now, lte: cutoff } },
    include: { product: { select: { code: true, name: true } }, warehouse: { select: { name: true } } },
    orderBy: { expiryDate: 'asc' },
  });
  const rows = batches.map(b => ({
    warehouse: b.warehouse.name, product_code: b.product.code, product_name: b.product.name,
    batch_no: b.batchNo, expiry_date: b.expiryDate, manufactured_at: b.manufacturedAt,
    qty_on_hand: b.qtyOnHand.toString(), qty_reserved: b.qtyReserved.toString(),
    days_to_expiry: Math.ceil((b.expiryDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  }));
  return { code: 'batch_expiry', title: 'Batch Expiry (FEFO)', filters: { within_days: daysAhead },
    columns: ['warehouse', 'product_code', 'product_name', 'batch_no', 'expiry_date', 'manufactured_at', 'qty_on_hand', 'qty_reserved', 'days_to_expiry'], rows,
    summary: { batch_count: rows.length, total_qty: batches.reduce((s, b) => s.plus(b.qtyOnHand), new Dec(0)).toFixed(4) } };
}

// 19. installment_due — upcoming installment due dates with paid/balance.
export async function reportInstallmentDue(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date();
  const defaultTo = new Date(); defaultTo.setDate(defaultTo.getDate() + 30);
  const to = filters.toDate ?? defaultTo;
  const installments = await db.installment.findMany({
    where: { companyId, status: 'scheduled', dueDate: { gte: from, lte: to } },
    include: { sale: { select: { referenceNo: true, customer: { select: { name: true } } } }, allocations: true },
    orderBy: { dueDate: 'asc' },
  });
  let totalBalance = new Dec(0);
  const rows = installments.map(i => {
    const paid = i.allocations.reduce((s, a) => s.plus(a.allocatedAmount), new Dec(0));
    const balance = new Dec(i.amount).minus(paid);
    totalBalance = totalBalance.plus(balance);
    return { due_date: i.dueDate, sale_ref: i.sale.referenceNo, customer: i.sale.customer?.name ?? 'Walk-in', installment_no: i.installmentNo, amount: i.amount.toString(), paid: paid.toFixed(2), balance_due: balance.toFixed(2), status: i.status };
  });
  return { code: 'installment_due', title: 'Installment Due Schedule', filters: { from, to },
    columns: ['due_date', 'sale_ref', 'customer', 'installment_no', 'amount', 'paid', 'balance_due', 'status'], rows,
    summary: { total_installments: rows.length, total_balance_due: totalBalance.toFixed(2) } };
}

// 20. delivery_status — delivery orders grouped by status.
export async function reportDeliveryStatus(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const grouped = await db.deliveryOrder.groupBy({
    by: ['status'],
    where: { companyId, createdAt: { gte: from, lte: to }, ...(filters.branchId ? { branchId: filters.branchId } : {}) },
    _count: { _all: true },
    _sum: { codAmount: true, deliveryFee: true },
  });
  const rows = grouped.map(g => ({ status: g.status, count: g._count._all, cod_total: dec(g._sum.codAmount).toFixed(2), delivery_fee_total: dec(g._sum.deliveryFee).toFixed(2) }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
  return { code: 'delivery_status', title: 'Delivery Status Summary', filters: { from, to, branch_id: filters.branchId ?? 'all' },
    columns: ['status', 'count', 'cod_total', 'delivery_fee_total'], rows,
    summary: { total_orders: rows.reduce((s, r) => s + r.count, 0) } };
}

// 21. courier_cod_reconciliation — COD receivable vs settled by courier.
//
// Settled amounts are attributed to the courier of the delivery order each
// settlement line settles, read by joining to that order. It used to look the
// order up among the first 10,000 orders only, and put every settlement line
// whose order fell outside them under 'unknown'.
//
// Receivable counts orders created in the window; settled counts settlements
// dated in the window. The two windows are independent, as before.
export async function reportCourierCodReconciliation(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const scope = reportSqlScope(companyId);
  const [receivable, settled] = await Promise.all([
    db.deliveryOrder.groupBy({
      by: ['courierCode'],
      where: { companyId, deliveryMethod: 'courier', codAmount: { gt: 0 }, createdAt: { gte: from, lte: to } },
      _sum: { codAmount: true },
    }),
    db.$queryRaw<Array<{ courier: string | null; n: bigint; cod: Prisma.Decimal | null; fee: Prisma.Decimal | null; adjustment: Prisma.Decimal | null }>>`
      SELECT d.courier_code AS courier, COUNT(*) AS n, SUM(i.cod_amount) AS cod,
             SUM(i.fee_amount) AS fee, SUM(i.adjustment_amount) AS adjustment
      FROM courier_cod_settlement_items i
      JOIN courier_cod_settlements s ON s.id = i.settlement_id
      JOIN delivery_orders d ON d.id = i.delivery_order_id AND d.company_id = s.company_id
      WHERE s.company_id = ${companyId} AND s.settlement_date BETWEEN ${from} AND ${to}
        ${scope.branch('s.branch_id')} ${scope.branch('d.branch_id')}
      GROUP BY d.courier_code`,
  ]);
  const zero = () => ({ cod_receivable: new Dec(0), settled_count: 0, settled_amount: new Dec(0), fee: new Dec(0), adjustment: new Dec(0) });
  const byCourier = new Map<string, ReturnType<typeof zero>>();
  const ensure = (k: string | null) => { const key = k ?? 'unknown'; if (!byCourier.has(key)) byCourier.set(key, zero()); return byCourier.get(key)!; };
  for (const r of receivable) { const c = ensure(r.courierCode); c.cod_receivable = c.cod_receivable.plus(dec(r._sum.codAmount)); }
  for (const s of settled) {
    const c = ensure(s.courier);
    c.settled_count += count(s.n); c.settled_amount = c.settled_amount.plus(dec(s.cod));
    c.fee = c.fee.plus(dec(s.fee)); c.adjustment = c.adjustment.plus(dec(s.adjustment));
  }
  const total = { receivable: new Dec(0), settled: new Dec(0), outstanding: new Dec(0) };
  const rows = Array.from(byCourier.entries()).map(([courier, c]) => {
    const outstanding = c.cod_receivable.minus(c.settled_amount);
    total.receivable = total.receivable.plus(c.cod_receivable); total.settled = total.settled.plus(c.settled_amount); total.outstanding = total.outstanding.plus(outstanding);
    return { courier, cod_receivable: c.cod_receivable.toFixed(2), settled_count: c.settled_count, settled_amount: c.settled_amount.toFixed(2), courier_fee: c.fee.toFixed(2), adjustment: c.adjustment.toFixed(2), net_settled: c.settled_amount.minus(c.fee).minus(c.adjustment).toFixed(2), outstanding: outstanding.toFixed(2), sortKey: c.cod_receivable };
  }).sort((a, b) => b.sortKey.comparedTo(a.sortKey) || a.courier.localeCompare(b.courier)).map(({ sortKey: _sortKey, ...row }) => row);
  return { code: 'courier_cod_reconciliation', title: 'Courier COD Reconciliation', filters: { from, to },
    columns: ['courier', 'cod_receivable', 'settled_count', 'settled_amount', 'courier_fee', 'adjustment', 'net_settled', 'outstanding'], rows,
    summary: { total_receivable: total.receivable.toFixed(2), total_settled: total.settled.toFixed(2), total_outstanding: total.outstanding.toFixed(2) } };
}

// 22. sales_objective — sales target vs actual by user/branch.
//
// A target's actual is the sales of its own period -- a January target is
// measured against January -- by the target's user in its branch, or by the
// whole branch when the target has no user. It used to be measured against every
// sale in the report window, from the first 10,000 of them.
const TARGET_LIMIT = 1000;

export async function reportSalesObjective(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const targetWhere = { companyId, periodStart: { gte: from }, periodEnd: { lte: to } };
  const [targetCount, targets] = await Promise.all([
    db.salesTarget.count({ where: targetWhere }),
    db.salesTarget.findMany({
      where: targetWhere,
      include: { branch: { select: { name: true } }, user: { select: { name: true, email: true } } },
      orderBy: [{ periodStart: 'asc' }, { id: 'asc' }],
      take: TARGET_LIMIT,
    }),
  ]);

  // One grouped query per distinct target period.
  const periods = new Map<string, { start: Date; end: Date }>();
  for (const t of targets) periods.set(`${t.periodStart.toISOString()}|${t.periodEnd.toISOString()}`, { start: t.periodStart, end: t.periodEnd });
  const actuals = new Map<string, { byUser: Map<string, Prisma.Decimal>; byBranch: Map<string, Prisma.Decimal> }>();
  await Promise.all([...periods.entries()].map(async ([key, period]) => {
    const grouped = await db.sale.groupBy({
      by: ['branchId', 'billerId'],
      where: { companyId, businessDate: { gte: period.start, lte: period.end }, saleStatus: { in: SALE_STATUSES } },
      _sum: { baseGrandTotal: true },
    });
    const byUser = new Map<string, Prisma.Decimal>();
    const byBranch = new Map<string, Prisma.Decimal>();
    for (const g of grouped) {
      const value = dec(g._sum.baseGrandTotal);
      byUser.set(`${g.branchId}|${g.billerId}`, value);
      byBranch.set(g.branchId, (byBranch.get(g.branchId) ?? new Dec(0)).plus(value));
    }
    actuals.set(key, { byUser, byBranch });
  }));

  let totalTarget = new Dec(0);
  let totalActual = new Dec(0);
  const rows = targets.map(t => {
    const period = actuals.get(`${t.periodStart.toISOString()}|${t.periodEnd.toISOString()}`)!;
    const target = new Dec(t.targetAmount);
    const actual = (t.userId ? period.byUser.get(`${t.branchId}|${t.userId}`) : period.byBranch.get(t.branchId)) ?? new Dec(0);
    totalTarget = totalTarget.plus(target);
    totalActual = totalActual.plus(actual);
    return { branch: t.branch.name, user: t.user?.name ?? '(branch total)', period_start: t.periodStart, period_end: t.periodEnd, target_amount: target.toFixed(2), actual_amount: actual.toFixed(2), achievement_pct: target.gt(0) ? actual.div(target).mul(100).toFixed(2) : '0.00' };
  });
  return { code: 'sales_objective', title: 'Sales Objective', filters: { from, to },
    columns: ['branch', 'user', 'period_start', 'period_end', 'target_amount', 'actual_amount', 'achievement_pct'], rows,
    summary: { total_target: totalTarget.toFixed(2), total_actual: totalActual.toFixed(2),
      detail_rows: rows.length, detail_row_limit: TARGET_LIMIT, detail_truncated: rows.length < targetCount } };
}

// ── Report Registry ──
export const REPORTS: Record<string, (companyId: string, ...args: any[]) => Promise<ReportResult>> = {
  trial_balance: reportTrialBalance,
  inventory_valuation: reportInventoryValuation,
  sales_summary: reportSalesSummary,
  stock_alert: reportStockAlert,
  ar_aging: reportArAging,
  ap_aging: reportApAging,
  dashboard_summary: reportDashboardSummary,
  profit_and_loss: reportProfitAndLoss,
  balance_sheet: reportBalanceSheet,
  cash_flow: reportCashFlow,
  daily_sales: reportDailySales,
  monthly_sales: reportMonthlySales,
  daily_purchases: reportDailyPurchases,
  monthly_purchases: reportMonthlyPurchases,
  customer_ledger: reportCustomerLedger,
  supplier_ledger: reportSupplierLedger,
  expense_report: reportExpenseReport,
  tax_summary: reportTaxSummary,
  best_seller: reportBestSeller,
  product_inventory: reportProductInventory,
  inventory_ledger: reportInventoryLedger,
  serial_history: reportSerialHistory,
  stock_count_variance: reportStockCountVariance,
  batch_expiry: reportBatchExpiry,
  installment_due: reportInstallmentDue,
  delivery_status: reportDeliveryStatus,
  courier_cod_reconciliation: reportCourierCodReconciliation,
  sales_objective: reportSalesObjective,
};
