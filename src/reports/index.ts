// src/reports/index.ts
// Report definitions per §11.5 catalogue.
// Each report is a function that queries the DB and returns structured data.

import { db } from '@/lib/db';

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

// ── Trial Balance (already has an API — this is the report definition) ──
export async function reportTrialBalance(companyId: string, asOf?: Date): Promise<ReportResult> {
  const lines = await db.journalLine.findMany({
    where: { companyId, journalEntry: { status: 'posted', entryDate: { lte: asOf ?? new Date() } } },
    include: { chartOfAccount: { select: { id: true, code: true, name: true, accountClass: true, normalBalance: true } } },
    take: 10000,
  });
  const accountMap = new Map<string, { code: string; name: string; accountClass: string; normalBalance: string; debit: number; credit: number }>();
  for (const line of lines) {
    const coa = line.chartOfAccount;
    if (!accountMap.has(coa.id)) accountMap.set(coa.id, { code: coa.code, name: coa.name, accountClass: coa.accountClass, normalBalance: coa.normalBalance, debit: 0, credit: 0 });
    const acct = accountMap.get(coa.id)!;
    acct.debit += parseFloat(line.debitBase.toString());
    acct.credit += parseFloat(line.creditBase.toString());
  }
  const rows = Array.from(accountMap.values()).map(a => ({
    code: a.code, name: a.name, account_class: a.accountClass,
    debit: a.debit.toFixed(2), credit: a.credit.toFixed(2),
    balance: (a.normalBalance === 'D' ? a.debit - a.credit : a.credit - a.debit).toFixed(2),
  })).sort((a, b) => (a.code as string).localeCompare(b.code as string));
  return { code: 'trial_balance', title: 'Trial Balance', filters: { as_of: asOf ?? new Date() },
    columns: ['code', 'name', 'account_class', 'debit', 'credit', 'balance'], rows,
    summary: { total_accounts: rows.length } };
}

// ── Inventory Valuation ──
export async function reportInventoryValuation(companyId: string, warehouseId?: string): Promise<ReportResult> {
  const stocks = await db.warehouseStock.findMany({
    where: { companyId, ...(warehouseId ? { warehouseId } : {}) },
    include: { product: { select: { code: true, name: true } }, warehouse: { select: { code: true, name: true } } },
    take: 10000,
  });
  const rows = stocks.map(s => ({
    warehouse: s.warehouse.name, product_code: s.product.code, product_name: s.product.name,
    qty_on_hand: s.qtyOnHand.toString(), moving_average_cost: s.movingAverageCost.toString(),
    inventory_value: (parseFloat(s.qtyOnHand.toString()) * parseFloat(s.movingAverageCost.toString())).toFixed(2),
  }));
  const totalValue = rows.reduce((sum, r) => sum + parseFloat(r.inventory_value as string), 0);
  return { code: 'inventory_valuation', title: 'Inventory Valuation', filters: { warehouse_id: warehouseId ?? 'all' },
    columns: ['warehouse', 'product_code', 'product_name', 'qty_on_hand', 'moving_average_cost', 'inventory_value'],
    rows, summary: { total_value: totalValue.toFixed(2), total_skus: rows.length } };
}

// ── Sales Summary ──
export async function reportSalesSummary(companyId: string, fromDate: Date, toDate: Date): Promise<ReportResult> {
  const sales = await db.sale.findMany({
    where: { companyId, businessDate: { gte: fromDate, lte: toDate }, saleStatus: { in: ['completed', 'partially_returned'] } },
    select: { id: true, referenceNo: true, grandTotal: true, businessDate: true, saleStatus: true, _count: { select: { items: true } } },
    take: 10000,
  });
  const rows = sales.map(s => ({
    reference_no: s.referenceNo, date: s.businessDate, status: s.saleStatus,
    grand_total: s.grandTotal.toString(), item_count: s._count.items,
  }));
  const totalRevenue = rows.reduce((sum, r) => sum + parseFloat(r.grand_total as string), 0);
  return { code: 'sales_summary', title: 'Sales Summary', filters: { from: fromDate, to: toDate },
    columns: ['reference_no', 'date', 'status', 'grand_total', 'item_count'],
    rows, summary: { total_sales: rows.length, total_revenue: totalRevenue.toFixed(2) } };
}

// ── Stock Alert (low stock) ──
export async function reportStockAlert(companyId: string): Promise<ReportResult> {
  const stocks = await db.warehouseStock.findMany({
    where: { companyId }, include: { product: { select: { code: true, name: true, alertQuantity: true } }, warehouse: { select: { name: true } } },
    take: 10000,
  });
  const rows = stocks.filter(s => {
    const available = parseFloat(s.qtyOnHand.toString()) - parseFloat(s.qtyReserved.toString());
    return available <= parseFloat(s.product.alertQuantity.toString());
  }).map(s => ({
    warehouse: s.warehouse.name, product_code: s.product.code, product_name: s.product.name,
    qty_on_hand: s.qtyOnHand.toString(), qty_reserved: s.qtyReserved.toString(),
    qty_available: (parseFloat(s.qtyOnHand.toString()) - parseFloat(s.qtyReserved.toString())).toFixed(4),
    alert_quantity: s.product.alertQuantity.toString(),
  }));
  return { code: 'stock_alert', title: 'Low Stock Alert', filters: {},
    columns: ['warehouse', 'product_code', 'product_name', 'qty_on_hand', 'qty_reserved', 'qty_available', 'alert_quantity'],
    rows, summary: { low_stock_count: rows.length } };
}

// ── AR Aging ──
export async function reportArAging(companyId: string): Promise<ReportResult> {
  const sales = await db.sale.findMany({
    where: { companyId, saleStatus: { in: ['completed', 'partially_returned'] } },
    include: { customer: { select: { name: true } }, payments: { select: { allocatedAmount: true } } },
    take: 10000,
  });
  const now = new Date();
  const rows = sales.map(s => {
    const totalPaid = s.payments.reduce((sum, p) => sum + parseFloat(p.allocatedAmount.toString()), 0);
    const due = parseFloat(s.grandTotal.toString()) - totalPaid;
    if (due <= 0.01) return null;
    const ageDays = Math.floor((now.getTime() - s.businessDate.getTime()) / (1000 * 60 * 60 * 24));
    return { reference_no: s.referenceNo, customer: s.customer?.name ?? 'Walk-in',
      sale_date: s.businessDate, amount_due: due.toFixed(2), age_days: ageDays,
      bucket: ageDays <= 30 ? '0-30' : ageDays <= 60 ? '31-60' : ageDays <= 90 ? '61-90' : '90+' };
  }).filter(Boolean) as Record<string, unknown>[];
  return { code: 'ar_aging', title: 'AR Aging', filters: {},
    columns: ['reference_no', 'customer', 'sale_date', 'amount_due', 'age_days', 'bucket'], rows,
    summary: { total_due: rows.reduce((s, r) => s + parseFloat(r.amount_due as string), 0).toFixed(2) } };
}

// ── AP Aging ──
export async function reportApAging(companyId: string): Promise<ReportResult> {
  const purchases = await db.purchase.findMany({
    where: { companyId }, include: { supplier: { select: { name: true } } },
    take: 10000,
  });
  const now = new Date();
  const rows = purchases.map(p => {
    const due = parseFloat(p.grandTotal.toString()); // simplified — no payment allocations for purchases yet
    if (due <= 0.01) return null;
    const ageDays = Math.floor((now.getTime() - p.orderDate.getTime()) / (1000 * 60 * 60 * 24));
    return { reference_no: p.referenceNo, supplier: p.supplier.name,
      order_date: p.orderDate, amount_due: due.toFixed(2), age_days: ageDays,
      bucket: ageDays <= 30 ? '0-30' : ageDays <= 60 ? '31-60' : ageDays <= 90 ? '61-90' : '90+' };
  }).filter(Boolean) as Record<string, unknown>[];
  return { code: 'ap_aging', title: 'AP Aging', filters: {},
    columns: ['reference_no', 'supplier', 'order_date', 'amount_due', 'age_days', 'bucket'], rows,
    summary: { total_due: rows.reduce((s, r) => s + parseFloat(r.amount_due as string), 0).toFixed(2) } };
}

// ════════════════════════════════════════════════════════════════════════
// §11.5 — Additional reports (P3A-Reports)
// Each function takes (companyId, filters?) and returns a ReportResult.
// Empty/missing filters → graceful empty rows, never errors.
// ════════════════════════════════════════════════════════════════════════

// 1. dashboard_summary — KPIs for the operator landing card.
export async function reportDashboardSummary(companyId: string): Promise<ReportResult> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const [salesAgg, arSales, approvals, shifts, stocks] = await Promise.all([
    db.sale.aggregate({ _sum: { grandTotal: true }, where: { companyId, businessDate: { gte: today, lt: tomorrow }, saleStatus: { in: ['completed', 'partially_returned'] } } }),
    db.sale.findMany({ where: { companyId, saleStatus: { in: ['completed', 'partially_returned'] } }, select: { grandTotal: true, payments: { select: { allocatedAmount: true } } }, take: 10000 }),
    db.approvalRequest.count({ where: { companyId, status: 'pending' } }),
    db.cashierShift.count({ where: { companyId, status: 'open' } }),
    db.warehouseStock.findMany({ where: { companyId }, include: { product: { select: { alertQuantity: true } } }, take: 10000 }),
  ]);
  const lowStockCount = stocks.filter(s => parseFloat(s.qtyOnHand.toString()) - parseFloat(s.qtyReserved.toString()) <= parseFloat(s.product.alertQuantity.toString())).length;
  const arOutstanding = arSales.reduce((sum, s) => {
    const paid = s.payments.reduce((p, x) => p + parseFloat(x.allocatedAmount.toString()), 0);
    const due = parseFloat(s.grandTotal.toString()) - paid;
    return sum + (due > 0.01 ? due : 0);
  }, 0);
  const todaySales = parseFloat((salesAgg._sum.grandTotal ?? 0).toString());
  const rows = [
    { metric: 'today_sales_total', value: todaySales.toFixed(2) },
    { metric: 'low_stock_count', value: String(lowStockCount) },
    { metric: 'ar_outstanding', value: arOutstanding.toFixed(2) },
    { metric: 'pending_approvals', value: String(approvals) },
    { metric: 'active_shifts', value: String(shifts) },
  ];
  return { code: 'dashboard_summary', title: 'Dashboard Summary', filters: { as_of: new Date() },
    columns: ['metric', 'value'], rows,
    summary: { today_sales_total: todaySales.toFixed(2), low_stock_count: lowStockCount, ar_outstanding: arOutstanding.toFixed(2), pending_approvals: approvals, active_shifts: shifts } };
}

// 2. profit_and_loss — Revenue − COGS − Expenses = Net Profit, by GL account.
export async function reportProfitAndLoss(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const lines = await db.journalLine.findMany({
    where: { companyId, journalEntry: { status: 'posted', entryDate: { gte: from, lte: to } } },
    include: { chartOfAccount: { select: { accountClass: true, code: true, name: true } } },
    take: 10000,
  });
  const byAcct = new Map<string, { accountClass: string; code: string; name: string; debit: number; credit: number }>();
  for (const l of lines) {
    const cls = l.chartOfAccount.accountClass;
    if (cls !== 'revenue' && cls !== 'expense') continue;
    if (!byAcct.has(l.chartOfAccountId)) byAcct.set(l.chartOfAccountId, { accountClass: cls, code: l.chartOfAccount.code, name: l.chartOfAccount.name, debit: 0, credit: 0 });
    const a = byAcct.get(l.chartOfAccountId)!;
    a.debit += parseFloat(l.debitBase.toString());
    a.credit += parseFloat(l.creditBase.toString());
  }
  const rows = Array.from(byAcct.values()).map(a => ({
    account_class: a.accountClass, code: a.code, name: a.name,
    debit: a.debit.toFixed(2), credit: a.credit.toFixed(2),
    balance: (a.accountClass === 'revenue' ? a.credit - a.debit : a.debit - a.credit).toFixed(2),
  })).sort((a, b) => (a.code as string).localeCompare(b.code as string));
  const revenue = Array.from(byAcct.values()).filter(a => a.accountClass === 'revenue').reduce((s, a) => s + (a.credit - a.debit), 0);
  const expense = Array.from(byAcct.values()).filter(a => a.accountClass === 'expense').reduce((s, a) => s + (a.debit - a.credit), 0);
  return { code: 'profit_and_loss', title: 'Profit & Loss', filters: { from, to },
    columns: ['account_class', 'code', 'name', 'debit', 'credit', 'balance'], rows,
    summary: { total_revenue: revenue.toFixed(2), total_expense: expense.toFixed(2), net_profit: (revenue - expense).toFixed(2) } };
}

// 3. balance_sheet — Assets, Liabilities, Equity as of a date.
export async function reportBalanceSheet(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const asOf = filters.asOf ?? new Date();
  const lines = await db.journalLine.findMany({
    where: { companyId, journalEntry: { status: 'posted', entryDate: { lte: asOf } } },
    include: { chartOfAccount: { select: { accountClass: true, code: true, name: true, normalBalance: true } } },
    take: 10000,
  });
  const byAcct = new Map<string, { accountClass: string; code: string; name: string; normalBalance: string; debit: number; credit: number }>();
  for (const l of lines) {
    const cls = l.chartOfAccount.accountClass;
    if (cls !== 'asset' && cls !== 'liability' && cls !== 'equity') continue;
    if (!byAcct.has(l.chartOfAccountId)) byAcct.set(l.chartOfAccountId, { accountClass: cls, code: l.chartOfAccount.code, name: l.chartOfAccount.name, normalBalance: l.chartOfAccount.normalBalance, debit: 0, credit: 0 });
    const a = byAcct.get(l.chartOfAccountId)!;
    a.debit += parseFloat(l.debitBase.toString());
    a.credit += parseFloat(l.creditBase.toString());
  }
  const totals = { asset: 0, liability: 0, equity: 0 };
  const rows = Array.from(byAcct.values()).map(a => {
    const bal = a.normalBalance === 'D' ? a.debit - a.credit : a.credit - a.debit;
    totals[a.accountClass as 'asset' | 'liability' | 'equity'] += bal;
    return { account_class: a.accountClass, code: a.code, name: a.name, balance: bal.toFixed(2) };
  }).sort((a, b) => (a.code as string).localeCompare(b.code as string));
  return { code: 'balance_sheet', title: 'Balance Sheet', filters: { as_of: asOf },
    columns: ['account_class', 'code', 'name', 'balance'], rows,
    summary: { total_assets: totals.asset.toFixed(2), total_liabilities: totals.liability.toFixed(2), total_equity: totals.equity.toFixed(2) } };
}

// 4. cash_flow — Cash in/out bucketed into operating / investing / financing
//    using the offsetting account class of each cash-account journal line.
export async function reportCashFlow(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const cashAccounts = await db.financialAccount.findMany({ where: { companyId, accountType: { in: ['cash', 'bank', 'mobile_wallet'] } }, select: { id: true } });
  const cashAccountIds = new Set(cashAccounts.map(a => a.id));
  if (cashAccountIds.size === 0) return { code: 'cash_flow', title: 'Cash Flow Statement', filters: { from, to }, columns: ['date', 'entry_no', 'category', 'description', 'direction', 'amount'], rows: [], summary: { operating_net: '0.00', investing_net: '0.00', financing_net: '0.00', net_change: '0.00' } };
  const entries = await db.journalEntry.findMany({
    where: { companyId, status: 'posted', entryDate: { gte: from, lte: to } },
    include: { lines: { include: { chartOfAccount: { select: { accountClass: true, accountSubtype: true } }, financialAccount: { select: { id: true } } }, take: 1000 } },
    orderBy: { entryDate: 'asc' },
    take: 5000,
  });
  const cat = { operating: 0, investing: 0, financing: 0 };
  const rows: Record<string, unknown>[] = [];
  for (const je of entries) {
    for (const cl of je.lines) {
      if (!cl.financialAccount || !cashAccountIds.has(cl.financialAccount.id)) continue;
      const net = parseFloat(cl.debitBase.toString()) - parseFloat(cl.creditBase.toString());
      let category = 'operating';
      for (const ol of je.lines) {
        if (ol.id === cl.id) continue;
        const cls = ol.chartOfAccount.accountClass;
        const sub = ol.chartOfAccount.accountSubtype ?? '';
        if (cls === 'asset' && (sub.includes('fixed') || sub.includes('non_current') || sub.includes('capital'))) category = 'investing';
        else if (cls === 'equity' || (cls === 'liability' && (sub.includes('long_term') || sub.includes('loan')))) category = 'financing';
      }
      (cat as Record<string, number>)[category] += net;
      rows.push({ date: je.entryDate, entry_no: je.entryNo, category, description: je.description, direction: net >= 0 ? 'in' : 'out', amount: Math.abs(net).toFixed(2) });
    }
  }
  return { code: 'cash_flow', title: 'Cash Flow Statement', filters: { from, to },
    columns: ['date', 'entry_no', 'category', 'description', 'direction', 'amount'], rows,
    summary: { operating_net: cat.operating.toFixed(2), investing_net: cat.investing.toFixed(2), financing_net: cat.financing.toFixed(2), net_change: (cat.operating + cat.investing + cat.financing).toFixed(2) } };
}

// 5. daily_sales — sales grouped by business date.
export async function reportDailySales(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const sales = await db.sale.findMany({
    where: { companyId, businessDate: { gte: from, lte: to }, saleStatus: { in: ['completed', 'partially_returned'] } },
    select: { businessDate: true, grandTotal: true, baseGrandTotal: true },
    take: 10000,
  });
  const byDay = new Map<string, { count: number; total: number; base_total: number }>();
  for (const s of sales) {
    const day = s.businessDate.toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { count: 0, total: 0, base_total: 0 });
    const d = byDay.get(day)!;
    d.count += 1; d.total += parseFloat(s.grandTotal.toString()); d.base_total += parseFloat(s.baseGrandTotal.toString());
  }
  const rows = Array.from(byDay.entries()).map(([day, d]) => ({ day, sale_count: d.count, total: d.total.toFixed(2), base_total: d.base_total.toFixed(2) })).sort((a, b) => (a.day as string).localeCompare(b.day as string));
  return { code: 'daily_sales', title: 'Daily Sales', filters: { from, to },
    columns: ['day', 'sale_count', 'total', 'base_total'], rows,
    summary: { total_sales: rows.reduce((s, r) => s + (r.sale_count as number), 0), total_amount: rows.reduce((s, r) => s + parseFloat(r.total as string), 0).toFixed(2) } };
}

// 6. monthly_sales — sales grouped by YYYY-MM.
export async function reportMonthlySales(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const sales = await db.sale.findMany({
    where: { companyId, businessDate: { gte: from, lte: to }, saleStatus: { in: ['completed', 'partially_returned'] } },
    select: { businessDate: true, grandTotal: true, baseGrandTotal: true },
    take: 10000,
  });
  const byMonth = new Map<string, { count: number; total: number; base_total: number }>();
  for (const s of sales) {
    const month = s.businessDate.toISOString().slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { count: 0, total: 0, base_total: 0 });
    const m = byMonth.get(month)!;
    m.count += 1; m.total += parseFloat(s.grandTotal.toString()); m.base_total += parseFloat(s.baseGrandTotal.toString());
  }
  const rows = Array.from(byMonth.entries()).map(([month, m]) => ({ month, sale_count: m.count, total: m.total.toFixed(2), base_total: m.base_total.toFixed(2) })).sort((a, b) => (a.month as string).localeCompare(b.month as string));
  return { code: 'monthly_sales', title: 'Monthly Sales', filters: { from, to },
    columns: ['month', 'sale_count', 'total', 'base_total'], rows,
    summary: { total_sales: rows.reduce((s, r) => s + (r.sale_count as number), 0), total_amount: rows.reduce((s, r) => s + parseFloat(r.total as string), 0).toFixed(2) } };
}

// 7. daily_purchases — purchases grouped by order date.
export async function reportDailyPurchases(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const purchases = await db.purchase.findMany({
    where: { companyId, orderDate: { gte: from, lte: to } },
    select: { orderDate: true, grandTotal: true, baseGrandTotal: true },
    take: 10000,
  });
  const byDay = new Map<string, { count: number; total: number; base_total: number }>();
  for (const p of purchases) {
    const day = p.orderDate.toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { count: 0, total: 0, base_total: 0 });
    const d = byDay.get(day)!;
    d.count += 1; d.total += parseFloat(p.grandTotal.toString()); d.base_total += parseFloat(p.baseGrandTotal.toString());
  }
  const rows = Array.from(byDay.entries()).map(([day, d]) => ({ day, purchase_count: d.count, total: d.total.toFixed(2), base_total: d.base_total.toFixed(2) })).sort((a, b) => (a.day as string).localeCompare(b.day as string));
  return { code: 'daily_purchases', title: 'Daily Purchases', filters: { from, to },
    columns: ['day', 'purchase_count', 'total', 'base_total'], rows,
    summary: { total_purchases: rows.reduce((s, r) => s + (r.purchase_count as number), 0), total_amount: rows.reduce((s, r) => s + parseFloat(r.total as string), 0).toFixed(2) } };
}

// 8. monthly_purchases — purchases grouped by YYYY-MM.
export async function reportMonthlyPurchases(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const purchases = await db.purchase.findMany({
    where: { companyId, orderDate: { gte: from, lte: to } },
    select: { orderDate: true, grandTotal: true, baseGrandTotal: true },
    take: 10000,
  });
  const byMonth = new Map<string, { count: number; total: number; base_total: number }>();
  for (const p of purchases) {
    const month = p.orderDate.toISOString().slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { count: 0, total: 0, base_total: 0 });
    const m = byMonth.get(month)!;
    m.count += 1; m.total += parseFloat(p.grandTotal.toString()); m.base_total += parseFloat(p.baseGrandTotal.toString());
  }
  const rows = Array.from(byMonth.entries()).map(([month, m]) => ({ month, purchase_count: m.count, total: m.total.toFixed(2), base_total: m.base_total.toFixed(2) })).sort((a, b) => (a.month as string).localeCompare(b.month as string));
  return { code: 'monthly_purchases', title: 'Monthly Purchases', filters: { from, to },
    columns: ['month', 'purchase_count', 'total', 'base_total'], rows,
    summary: { total_purchases: rows.reduce((s, r) => s + (r.purchase_count as number), 0), total_amount: rows.reduce((s, r) => s + parseFloat(r.total as string), 0).toFixed(2) } };
}

// 9. customer_ledger — all posted journal lines for a customer, running balance.
export async function reportCustomerLedger(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  if (!filters.customerId) return { code: 'customer_ledger', title: 'Customer Ledger', filters: { customer_id: null, from, to }, columns: ['date', 'entry_no', 'description', 'debit', 'credit', 'balance'], rows: [], summary: { total_debit: '0.00', total_credit: '0.00', closing_balance: '0.00' } };
  const lines = await db.journalLine.findMany({
    where: { companyId, customerId: filters.customerId, journalEntry: { status: 'posted', entryDate: { gte: from, lte: to } } },
    include: { journalEntry: { select: { entryNo: true, entryDate: true, description: true } } },
    orderBy: { journalEntry: { entryDate: 'asc' } },
    take: 10000,
  });
  let running = 0;
  const rows = lines.map(l => {
    const debit = parseFloat(l.debitBase.toString());
    const credit = parseFloat(l.creditBase.toString());
    running += debit - credit;
    return { date: l.journalEntry.entryDate, entry_no: l.journalEntry.entryNo, description: l.journalEntry.description, debit: debit.toFixed(2), credit: credit.toFixed(2), balance: running.toFixed(2) };
  });
  const totalDebit = lines.reduce((s, l) => s + parseFloat(l.debitBase.toString()), 0);
  const totalCredit = lines.reduce((s, l) => s + parseFloat(l.creditBase.toString()), 0);
  return { code: 'customer_ledger', title: 'Customer Ledger', filters: { customer_id: filters.customerId, from, to },
    columns: ['date', 'entry_no', 'description', 'debit', 'credit', 'balance'], rows,
    summary: { total_debit: totalDebit.toFixed(2), total_credit: totalCredit.toFixed(2), closing_balance: running.toFixed(2) } };
}

// 10. supplier_ledger — all posted journal lines for a supplier, running balance.
export async function reportSupplierLedger(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  if (!filters.supplierId) return { code: 'supplier_ledger', title: 'Supplier Ledger', filters: { supplier_id: null, from, to }, columns: ['date', 'entry_no', 'description', 'debit', 'credit', 'balance'], rows: [], summary: { total_debit: '0.00', total_credit: '0.00', closing_balance: '0.00' } };
  const lines = await db.journalLine.findMany({
    where: { companyId, supplierId: filters.supplierId, journalEntry: { status: 'posted', entryDate: { gte: from, lte: to } } },
    include: { journalEntry: { select: { entryNo: true, entryDate: true, description: true } } },
    orderBy: { journalEntry: { entryDate: 'asc' } },
    take: 10000,
  });
  let running = 0;
  const rows = lines.map(l => {
    const debit = parseFloat(l.debitBase.toString());
    const credit = parseFloat(l.creditBase.toString());
    running += debit - credit;
    return { date: l.journalEntry.entryDate, entry_no: l.journalEntry.entryNo, description: l.journalEntry.description, debit: debit.toFixed(2), credit: credit.toFixed(2), balance: running.toFixed(2) };
  });
  const totalDebit = lines.reduce((s, l) => s + parseFloat(l.debitBase.toString()), 0);
  const totalCredit = lines.reduce((s, l) => s + parseFloat(l.creditBase.toString()), 0);
  return { code: 'supplier_ledger', title: 'Supplier Ledger', filters: { supplier_id: filters.supplierId, from, to },
    columns: ['date', 'entry_no', 'description', 'debit', 'credit', 'balance'], rows,
    summary: { total_debit: totalDebit.toFixed(2), total_credit: totalCredit.toFixed(2), closing_balance: running.toFixed(2) } };
}

// 11. expense_report — expenses grouped by category.
export async function reportExpenseReport(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const items = await db.expenseItem.findMany({
    where: { companyId, expense: { expenseDate: { gte: from, lte: to }, status: 'posted' } },
    include: { expenseCategory: { select: { name: true } } },
    take: 10000,
  });
  const byCat = new Map<string, { name: string; count: number; amount: number; tax: number }>();
  for (const it of items) {
    if (!byCat.has(it.expenseCategoryId)) byCat.set(it.expenseCategoryId, { name: it.expenseCategory.name, count: 0, amount: 0, tax: 0 });
    const c = byCat.get(it.expenseCategoryId)!;
    c.count += 1; c.amount += parseFloat(it.amount.toString()); c.tax += parseFloat(it.taxAmount.toString());
  }
  const rows = Array.from(byCat.entries()).map(([id, c]) => ({ category_id: id, category: c.name, expense_count: c.count, amount: c.amount.toFixed(2), tax: c.tax.toFixed(2), total: (c.amount + c.tax).toFixed(2) })).sort((a, b) => parseFloat(b.total as string) - parseFloat(a.total as string));
  return { code: 'expense_report', title: 'Expense Report', filters: { from, to },
    columns: ['category_id', 'category', 'expense_count', 'amount', 'tax', 'total'], rows,
    summary: { total_amount: rows.reduce((s, r) => s + parseFloat(r.amount as string), 0).toFixed(2), total_tax: rows.reduce((s, r) => s + parseFloat(r.tax as string), 0).toFixed(2) } };
}

// 12. tax_summary — VAT output (sales) vs VAT input (purchases) by tax component code.
export async function reportTaxSummary(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const [saleTaxes, purchTaxes] = await Promise.all([
    db.saleItemTax.findMany({ where: { companyId, saleItem: { sale: { businessDate: { gte: from, lte: to }, saleStatus: { in: ['completed', 'partially_returned'] } } } }, select: { componentCodeSnapshot: true, taxAmount: true, taxableBase: true }, take: 10000 }),
    db.purchaseItemTax.findMany({ where: { companyId, purchaseItem: { purchase: { orderDate: { gte: from, lte: to } } } }, select: { componentCodeSnapshot: true, taxAmount: true, taxableBase: true, recoverableAmount: true }, take: 10000 }),
  ]);
  const byCode = new Map<string, { output_tax: number; input_tax: number; output_base: number; input_base: number; recoverable: number }>();
  const ensure = (code: string) => { if (!byCode.has(code)) byCode.set(code, { output_tax: 0, input_tax: 0, output_base: 0, input_base: 0, recoverable: 0 }); return byCode.get(code)!; };
  for (const t of saleTaxes) { const c = ensure(t.componentCodeSnapshot); c.output_tax += parseFloat(t.taxAmount.toString()); c.output_base += parseFloat(t.taxableBase.toString()); }
  for (const t of purchTaxes) { const c = ensure(t.componentCodeSnapshot); c.input_tax += parseFloat(t.taxAmount.toString()); c.input_base += parseFloat(t.taxableBase.toString()); c.recoverable += parseFloat(t.recoverableAmount.toString()); }
  const rows = Array.from(byCode.entries()).map(([code, c]) => ({ tax_code: code, output_base: c.output_base.toFixed(2), output_tax: c.output_tax.toFixed(2), input_base: c.input_base.toFixed(2), input_tax: c.input_tax.toFixed(2), recoverable: c.recoverable.toFixed(2), net_payable: (c.output_tax - c.recoverable).toFixed(2) })).sort((a, b) => (a.tax_code as string).localeCompare(b.tax_code as string));
  return { code: 'tax_summary', title: 'Tax Summary', filters: { from, to },
    columns: ['tax_code', 'output_base', 'output_tax', 'input_base', 'input_tax', 'recoverable', 'net_payable'], rows,
    summary: { total_output_tax: rows.reduce((s, r) => s + parseFloat(r.output_tax as string), 0).toFixed(2), total_input_tax: rows.reduce((s, r) => s + parseFloat(r.input_tax as string), 0).toFixed(2), net_payable: rows.reduce((s, r) => s + parseFloat(r.net_payable as string), 0).toFixed(2) } };
}

// 13. best_seller — top N products by sales quantity (and amount).
export async function reportBestSeller(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const top = filters.limit ?? 20;
  const items = await db.saleItem.findMany({
    where: { companyId, sale: { businessDate: { gte: from, lte: to }, saleStatus: { in: ['completed', 'partially_returned'] } } },
    select: { productId: true, productCodeSnapshot: true, productNameSnapshot: true, qty: true, lineTotal: true },
    take: 10000,
  });
  const byProd = new Map<string, { code: string; name: string; qty: number; amount: number }>();
  for (const it of items) {
    if (!byProd.has(it.productId)) byProd.set(it.productId, { code: it.productCodeSnapshot, name: it.productNameSnapshot, qty: 0, amount: 0 });
    const p = byProd.get(it.productId)!;
    p.qty += parseFloat(it.qty.toString()); p.amount += parseFloat(it.lineTotal.toString());
  }
  const rows = Array.from(byProd.entries()).map(([id, p]) => ({ product_id: id, product_code: p.code, product_name: p.name, qty_sold: p.qty.toFixed(4), sales_amount: p.amount.toFixed(2) })).sort((a, b) => parseFloat(b.qty_sold as string) - parseFloat(a.qty_sold as string)).slice(0, top);
  return { code: 'best_seller', title: 'Best Sellers', filters: { from, to, top_n: top },
    columns: ['product_id', 'product_code', 'product_name', 'qty_sold', 'sales_amount'], rows,
    summary: { total_qty: rows.reduce((s, r) => s + parseFloat(r.qty_sold as string), 0).toFixed(4), total_amount: rows.reduce((s, r) => s + parseFloat(r.sales_amount as string), 0).toFixed(2) } };
}

// 14. product_inventory — detailed inventory with last movement timestamp.
export async function reportProductInventory(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const stocks = await db.warehouseStock.findMany({
    where: { companyId, ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}) },
    include: { product: { select: { code: true, name: true } }, warehouse: { select: { code: true, name: true } } },
  });
  const movements = await db.stockMovement.findMany({
    where: { companyId, ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}) },
    orderBy: { effectiveAt: 'desc' },
    select: { productId: true, warehouseId: true, effectiveAt: true, movementType: true },
    take: 10000,
  });
  const lastMv = new Map<string, { effectiveAt: Date; movementType: string }>();
  for (const m of movements) {
    const k = `${m.productId}|${m.warehouseId}`;
    if (!lastMv.has(k)) lastMv.set(k, { effectiveAt: m.effectiveAt, movementType: m.movementType });
  }
  const rows = stocks.map(s => {
    const last = lastMv.get(`${s.productId}|${s.warehouseId}`);
    return {
      warehouse: s.warehouse.name, product_code: s.product.code, product_name: s.product.name,
      qty_on_hand: s.qtyOnHand.toString(), qty_reserved: s.qtyReserved.toString(),
      moving_average_cost: s.movingAverageCost.toString(),
      inventory_value: (parseFloat(s.qtyOnHand.toString()) * parseFloat(s.movingAverageCost.toString())).toFixed(2),
      last_movement_at: last?.effectiveAt ?? null, last_movement_type: last?.movementType ?? null,
    };
  });
  const totalValue = rows.reduce((s, r) => s + parseFloat(r.inventory_value as string), 0);
  return { code: 'product_inventory', title: 'Product Inventory', filters: { warehouse_id: filters.warehouseId ?? 'all' },
    columns: ['warehouse', 'product_code', 'product_name', 'qty_on_hand', 'qty_reserved', 'moving_average_cost', 'inventory_value', 'last_movement_at', 'last_movement_type'], rows,
    summary: { total_skus: rows.length, total_value: totalValue.toFixed(2) } };
}

// 15. inventory_ledger — stock movements for a product/warehouse over time.
export async function reportInventoryLedger(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  if (!filters.productId) return { code: 'inventory_ledger', title: 'Inventory Ledger', filters: { product_id: null, from, to }, columns: ['date', 'movement_type', 'reference_type', 'reference_id', 'qty_delta', 'unit_cost', 'total_cost_delta'], rows: [], summary: { net_qty_delta: '0.0000' } };
  const movements = await db.stockMovement.findMany({
    where: { companyId, productId: filters.productId, effectiveAt: { gte: from, lte: to }, ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}) },
    orderBy: { effectiveAt: 'asc' },
    include: { warehouse: { select: { name: true } } },
    take: 10000,
  });
  let running = 0;
  const rows = movements.map(m => {
    const delta = parseFloat(m.qtyDelta.toString());
    running += delta;
    return { date: m.effectiveAt, warehouse: m.warehouse.name, movement_type: m.movementType, reference_type: m.referenceType, reference_id: m.referenceId, qty_delta: delta.toFixed(4), unit_cost: m.unitCost.toString(), total_cost_delta: m.totalCostDelta.toString(), running_qty: running.toFixed(4) };
  });
  return { code: 'inventory_ledger', title: 'Inventory Ledger', filters: { product_id: filters.productId, warehouse_id: filters.warehouseId ?? 'all', from, to },
    columns: ['date', 'warehouse', 'movement_type', 'reference_type', 'reference_id', 'qty_delta', 'unit_cost', 'total_cost_delta', 'running_qty'], rows,
    summary: { net_qty_delta: running.toFixed(4), movement_count: rows.length } };
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
export async function reportStockCountVariance(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const items = await db.stockCountItem.findMany({
    where: { companyId, countedQuantity: { not: null }, ...(filters.warehouseId ? { stockCount: { warehouseId: filters.warehouseId } } : {}) },
    include: { product: { select: { code: true, name: true } }, stockCount: { select: { referenceNo: true, postedAt: true, warehouse: { select: { name: true } } } } },
    take: 10000,
  });
  const rows = items.map(i => {
    const expected = parseFloat(i.expectedQuantity.toString());
    const counted = i.countedQuantity ? parseFloat(i.countedQuantity.toString()) : 0;
    const variance = i.varianceQuantity ? parseFloat(i.varianceQuantity.toString()) : (counted - expected);
    return { count_ref: i.stockCount.referenceNo, posted_at: i.stockCount.postedAt, warehouse: i.stockCount.warehouse.name, product_code: i.product.code, product_name: i.product.name, expected: expected.toFixed(4), counted: counted.toFixed(4), variance: variance.toFixed(4) };
  }).sort((a, b) => (a.count_ref as string).localeCompare(b.count_ref as string));
  const totalVar = rows.reduce((s, r) => s + parseFloat(r.variance as string), 0);
  return { code: 'stock_count_variance', title: 'Stock Count Variance', filters: { warehouse_id: filters.warehouseId ?? 'all' },
    columns: ['count_ref', 'posted_at', 'warehouse', 'product_code', 'product_name', 'expected', 'counted', 'variance'], rows,
    summary: { total_items: rows.length, total_variance: totalVar.toFixed(4) } };
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
    summary: { batch_count: rows.length, total_qty: rows.reduce((s, r) => s + parseFloat(r.qty_on_hand as string), 0).toFixed(4) } };
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
  const rows = installments.map(i => {
    const paid = i.allocations.reduce((s, a) => s + parseFloat(a.allocatedAmount.toString()), 0);
    const balance = parseFloat(i.amount.toString()) - paid;
    return { due_date: i.dueDate, sale_ref: i.sale.referenceNo, customer: i.sale.customer?.name ?? 'Walk-in', installment_no: i.installmentNo, amount: i.amount.toString(), paid: paid.toFixed(2), balance_due: balance.toFixed(2), status: i.status };
  });
  return { code: 'installment_due', title: 'Installment Due Schedule', filters: { from, to },
    columns: ['due_date', 'sale_ref', 'customer', 'installment_no', 'amount', 'paid', 'balance_due', 'status'], rows,
    summary: { total_installments: rows.length, total_balance_due: rows.reduce((s, r) => s + parseFloat(r.balance_due as string), 0).toFixed(2) } };
}

// 20. delivery_status — delivery orders grouped by status.
export async function reportDeliveryStatus(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const orders = await db.deliveryOrder.findMany({
    where: { companyId, createdAt: { gte: from, lte: to }, ...(filters.branchId ? { branchId: filters.branchId } : {}) },
    select: { status: true, codAmount: true, deliveryFee: true },
    take: 10000,
  });
  const byStatus = new Map<string, { count: number; cod: number; fee: number }>();
  for (const o of orders) {
    if (!byStatus.has(o.status)) byStatus.set(o.status, { count: 0, cod: 0, fee: 0 });
    const s = byStatus.get(o.status)!;
    s.count += 1; s.cod += parseFloat(o.codAmount.toString()); s.fee += parseFloat(o.deliveryFee.toString());
  }
  const rows = Array.from(byStatus.entries()).map(([status, s]) => ({ status, count: s.count, cod_total: s.cod.toFixed(2), delivery_fee_total: s.fee.toFixed(2) })).sort((a, b) => (b.count as number) - (a.count as number));
  return { code: 'delivery_status', title: 'Delivery Status Summary', filters: { from, to, branch_id: filters.branchId ?? 'all' },
    columns: ['status', 'count', 'cod_total', 'delivery_fee_total'], rows,
    summary: { total_orders: rows.reduce((s, r) => s + (r.count as number), 0) } };
}

// 21. courier_cod_reconciliation — COD receivable vs settled by courier.
export async function reportCourierCodReconciliation(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const [orders, settledItems] = await Promise.all([
    db.deliveryOrder.findMany({ where: { companyId, deliveryMethod: 'courier', codAmount: { gt: 0 }, createdAt: { gte: from, lte: to } }, select: { id: true, courierCode: true, codAmount: true, status: true }, take: 10000 }),
    db.courierCodSettlementItem.findMany({ where: { settlement: { companyId, settlementDate: { gte: from, lte: to } } }, select: { deliveryOrderId: true, codAmount: true, feeAmount: true, adjustmentAmount: true }, take: 10000 }),
  ]);
  const byCourier = new Map<string, { cod_receivable: number; settled_count: number; settled_amount: number; fee: number; adjustment: number }>();
  const ensure = (k: string) => { if (!byCourier.has(k)) byCourier.set(k, { cod_receivable: 0, settled_count: 0, settled_amount: 0, fee: 0, adjustment: 0 }); return byCourier.get(k)!; };
  const orderCourier = new Map<string, string>();
  for (const o of orders) { const k = o.courierCode ?? 'unknown'; orderCourier.set(o.id, k); ensure(k).cod_receivable += parseFloat(o.codAmount.toString()); }
  for (const it of settledItems) { const k = orderCourier.get(it.deliveryOrderId) ?? 'unknown'; const c = ensure(k); c.settled_count += 1; c.settled_amount += parseFloat(it.codAmount.toString()); c.fee += parseFloat(it.feeAmount.toString()); c.adjustment += parseFloat(it.adjustmentAmount.toString()); }
  const rows = Array.from(byCourier.entries()).map(([courier, c]) => ({ courier, cod_receivable: c.cod_receivable.toFixed(2), settled_count: c.settled_count, settled_amount: c.settled_amount.toFixed(2), courier_fee: c.fee.toFixed(2), adjustment: c.adjustment.toFixed(2), net_settled: (c.settled_amount - c.fee - c.adjustment).toFixed(2), outstanding: (c.cod_receivable - c.settled_amount).toFixed(2) })).sort((a, b) => parseFloat(b.cod_receivable as string) - parseFloat(a.cod_receivable as string));
  return { code: 'courier_cod_reconciliation', title: 'Courier COD Reconciliation', filters: { from, to },
    columns: ['courier', 'cod_receivable', 'settled_count', 'settled_amount', 'courier_fee', 'adjustment', 'net_settled', 'outstanding'], rows,
    summary: { total_receivable: rows.reduce((s, r) => s + parseFloat(r.cod_receivable as string), 0).toFixed(2), total_settled: rows.reduce((s, r) => s + parseFloat(r.settled_amount as string), 0).toFixed(2), total_outstanding: rows.reduce((s, r) => s + parseFloat(r.outstanding as string), 0).toFixed(2) } };
}

// 22. sales_objective — sales target vs actual by user/branch.
export async function reportSalesObjective(companyId: string, filters: ReportFilters = {}): Promise<ReportResult> {
  const from = filters.fromDate ?? new Date(0);
  const to = filters.toDate ?? new Date();
  const [targets, sales] = await Promise.all([
    db.salesTarget.findMany({ where: { companyId, periodStart: { gte: from }, periodEnd: { lte: to } }, include: { branch: { select: { name: true } }, user: { select: { name: true, email: true } } }, take: 1000 }),
    db.sale.findMany({ where: { companyId, businessDate: { gte: from, lte: to }, saleStatus: { in: ['completed', 'partially_returned'] } }, select: { branchId: true, billerId: true, baseGrandTotal: true }, take: 10000 }),
  ]);
  const byBranchUser = new Map<string, number>();
  const byBranch = new Map<string, number>();
  for (const s of sales) {
    const bu = `${s.branchId}|${s.billerId}`;
    const v = parseFloat(s.baseGrandTotal.toString());
    byBranchUser.set(bu, (byBranchUser.get(bu) ?? 0) + v);
    byBranch.set(s.branchId, (byBranch.get(s.branchId) ?? 0) + v);
  }
  const rows = targets.map(t => {
    const target = parseFloat(t.targetAmount.toString());
    const actual = t.userId ? (byBranchUser.get(`${t.branchId}|${t.userId}`) ?? 0) : (byBranch.get(t.branchId) ?? 0);
    return { branch: t.branch.name, user: t.user?.name ?? '(branch total)', period_start: t.periodStart, period_end: t.periodEnd, target_amount: target.toFixed(2), actual_amount: actual.toFixed(2), achievement_pct: target > 0 ? ((actual / target) * 100).toFixed(2) : '0.00' };
  });
  return { code: 'sales_objective', title: 'Sales Objective', filters: { from, to },
    columns: ['branch', 'user', 'period_start', 'period_end', 'target_amount', 'actual_amount', 'achievement_pct'], rows,
    summary: { total_target: rows.reduce((s, r) => s + parseFloat(r.target_amount as string), 0).toFixed(2), total_actual: rows.reduce((s, r) => s + parseFloat(r.actual_amount as string), 0).toFixed(2) } };
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
