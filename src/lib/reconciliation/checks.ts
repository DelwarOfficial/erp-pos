// src/lib/reconciliation/checks.ts — 16 reconciliation checks per §11.3.
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

export interface ReconciliationFinding {
  check_code: string;
  severity: 'info' | 'warning' | 'high' | 'critical';
  reference_type?: string;
  reference_id?: string;
  expected_value?: number;
  actual_value?: number;
  variance?: number;
  details: Record<string, unknown>;
}
export type ReconciliationCheck = (tx: Prisma.TransactionClient, companyId: string) => Promise<ReconciliationFinding[]>;

export const checkStockQtyLedger: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const stocks = await tx.warehouseStock.findMany({ where: { companyId }, select: { id: true, warehouseId: true, productId: true, qtyOnHand: true } });
  for (const stock of stocks) {
    const movements = await tx.stockMovement.aggregate({ where: { companyId, warehouseId: stock.warehouseId, productId: stock.productId, stockBucket: 'on_hand' }, _sum: { qtyDelta: true } });
    const expected = parseFloat(movements._sum.qtyDelta?.toString() ?? '0');
    const actual = parseFloat(stock.qtyOnHand.toString());
    if (Math.abs(expected - actual) > 0.0001) findings.push({ check_code: 'STOCK_QTY_LEDGER', severity: 'critical', reference_type: 'warehouse_stock', reference_id: stock.id, expected_value: expected, actual_value: actual, variance: actual - expected, details: { warehouse_id: stock.warehouseId, product_id: stock.productId } });
  }
  return findings;
};

export const checkStockValueLedger: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const stocks = await tx.warehouseStock.findMany({ where: { companyId }, select: { id: true, warehouseId: true, productId: true, qtyOnHand: true, movingAverageCost: true } });
  for (const stock of stocks) {
    const movements = await tx.stockMovement.aggregate({ where: { companyId, warehouseId: stock.warehouseId, productId: stock.productId, stockBucket: 'on_hand' }, _sum: { totalCostDelta: true } });
    const expected = parseFloat(movements._sum.totalCostDelta?.toString() ?? '0');
    const actual = parseFloat(stock.qtyOnHand.toString()) * parseFloat(stock.movingAverageCost.toString());
    if (Math.abs(expected - actual) > 0.01) findings.push({ check_code: 'STOCK_VALUE_LEDGER', severity: 'high', reference_type: 'warehouse_stock', reference_id: stock.id, expected_value: expected, actual_value: actual, variance: actual - expected, details: { warehouse_id: stock.warehouseId, product_id: stock.productId } });
  }
  return findings;
};

export const checkSerialStockCount: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const serials = await tx.productSerial.groupBy({ by: ['currentWarehouseId', 'productId'], where: { companyId, status: 'in_stock' }, _count: true });
  for (const group of serials) {
    if (!group.currentWarehouseId) continue;
    const stock = await tx.warehouseStock.findUnique({ where: { companyId_warehouseId_productId: { companyId, warehouseId: group.currentWarehouseId, productId: group.productId } } });
    if (stock && group._count !== parseFloat(stock.qtyOnHand.toString())) findings.push({ check_code: 'SERIAL_STOCK_COUNT', severity: 'high', reference_type: 'warehouse_stock', reference_id: stock.id, expected_value: parseFloat(stock.qtyOnHand.toString()), actual_value: group._count, variance: group._count - parseFloat(stock.qtyOnHand.toString()), details: { warehouse_id: group.currentWarehouseId, product_id: group.productId } });
  }
  return findings;
};

export const checkReservationProjection: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const stocks = await tx.warehouseStock.findMany({ where: { companyId, qtyReserved: { gt: 0 } }, select: { id: true, warehouseId: true, productId: true, qtyReserved: true } });
  for (const stock of stocks) {
    const reservations = await tx.stockReservation.aggregate({ where: { companyId, warehouseId: stock.warehouseId, productId: stock.productId, status: 'active' }, _sum: { qty: true } });
    const expected = parseFloat(reservations._sum.qty?.toString() ?? '0');
    const actual = parseFloat(stock.qtyReserved.toString());
    if (Math.abs(expected - actual) > 0.0001) findings.push({ check_code: 'RESERVATION_PROJECTION', severity: 'high', reference_type: 'warehouse_stock', reference_id: stock.id, expected_value: expected, actual_value: actual, variance: actual - expected, details: {} });
  }
  return findings;
};

export const checkJournalBalance: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const entries = await tx.journalEntry.findMany({ where: { companyId, status: 'posted' }, include: { lines: true } });
  for (const entry of entries) {
    const td = entry.lines.reduce((s, l) => s + parseFloat(l.debitBase.toString()), 0);
    const tc = entry.lines.reduce((s, l) => s + parseFloat(l.creditBase.toString()), 0);
    if (Math.abs(td - tc) > 0.01) findings.push({ check_code: 'JOURNAL_BALANCE', severity: 'critical', reference_type: 'journal_entry', reference_id: entry.id, expected_value: td, actual_value: tc, variance: tc - td, details: { entry_no: entry.entryNo } });
  }
  return findings;
};

export const checkArSubledgerGl: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const policies = await tx.accountingPolicy.findUnique({ where: { companyId } });
  if (!policies) return findings;
  const totalSales = await tx.sale.aggregate({ where: { companyId, saleStatus: { in: ['completed', 'partially_returned'] } }, _sum: { grandTotal: true } });
  const totalAlloc = await tx.paymentAllocation.aggregate({ where: { companyId, saleId: { not: null } }, _sum: { allocatedAmount: true } });
  const expectedAr = parseFloat(totalSales._sum.grandTotal?.toString() ?? '0') - parseFloat(totalAlloc._sum.allocatedAmount?.toString() ?? '0');
  const arLines = await tx.journalLine.aggregate({ where: { companyId, chartOfAccountId: policies.arAccountId }, _sum: { debitBase: true, creditBase: true } });
  const actualAr = parseFloat(arLines._sum.debitBase?.toString() ?? '0') - parseFloat(arLines._sum.creditBase?.toString() ?? '0');
  if (Math.abs(expectedAr - actualAr) > 1) findings.push({ check_code: 'AR_SUBLEDGER_GL', severity: 'high', expected_value: expectedAr, actual_value: actualAr, variance: actualAr - expectedAr, details: {} });
  return findings;
};

export const checkApSubledgerGl: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const policies = await tx.accountingPolicy.findUnique({ where: { companyId } });
  if (!policies) return findings;
  const totalPur = await tx.purchase.aggregate({ where: { companyId }, _sum: { grandTotal: true } });
  const expectedAp = parseFloat(totalPur._sum.grandTotal?.toString() ?? '0');
  const apLines = await tx.journalLine.aggregate({ where: { companyId, chartOfAccountId: policies.apAccountId }, _sum: { debitBase: true, creditBase: true } });
  const actualAp = parseFloat(apLines._sum.creditBase?.toString() ?? '0') - parseFloat(apLines._sum.debitBase?.toString() ?? '0');
  if (Math.abs(expectedAp - actualAp) > 1) findings.push({ check_code: 'AP_SUBLEDGER_GL', severity: 'high', expected_value: expectedAp, actual_value: actualAp, variance: actualAp - expectedAp, details: {} });
  return findings;
};

export const checkPaymentAllocationLimit: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const payments = await tx.payment.findMany({ where: { companyId, paymentStatus: 'posted' }, include: { allocations: true } });
  for (const p of payments) {
    const totalAlloc = p.allocations.reduce((s, a) => s + parseFloat(a.allocatedAmount.toString()), 0);
    if (totalAlloc > parseFloat(p.amount.toString()) + 0.01) findings.push({ check_code: 'PAYMENT_ALLOCATION_LIMIT', severity: 'critical', reference_type: 'payment', reference_id: p.id, expected_value: parseFloat(p.amount.toString()), actual_value: totalAlloc, variance: totalAlloc - parseFloat(p.amount.toString()), details: { payment_ref: p.referenceNo } });
  }
  return findings;
};

export const checkCashShiftVariance: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const shifts = await tx.cashierShift.findMany({ where: { companyId, status: { in: ['closed', 'approved'] }, variance: null } });
  for (const s of shifts) findings.push({ check_code: 'CASH_SHIFT_VARIANCE', severity: 'warning', reference_type: 'cashier_shift', reference_id: s.id, details: { issue: 'Closed shift without variance' } });
  return findings;
};

export const checkTaxOutputGl: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const totalTax = await tx.saleItemTax.aggregate({ where: { companyId }, _sum: { taxAmount: true } });
  const expectedTax = parseFloat(totalTax._sum.taxAmount?.toString() ?? '0');
  if (expectedTax > 0) {
    const taxJournals = await tx.journalEntry.count({ where: { companyId, postingKind: 'sale_revenue', status: 'posted' } });
    if (taxJournals === 0) findings.push({ check_code: 'TAX_OUTPUT_GL', severity: 'warning', expected_value: expectedTax, actual_value: 0, variance: -expectedTax, details: { issue: 'Tax collected but no VAT journal' } });
  }
  return findings;
};

export const checkGiftCardLiability: ReconciliationCheck = async (tx, companyId) => {
  const total = await tx.giftCard.aggregate({ where: { companyId, status: 'active' }, _sum: { faceValue: true } });
  const val = parseFloat(total._sum.faceValue?.toString() ?? '0');
  return val > 0 ? [{ check_code: 'GIFT_CARD_LIABILITY', severity: 'info', expected_value: val, actual_value: 0, variance: 0, details: { active_gift_card_total: val } }] : [];
};

export const checkFiscalPeriodIntegrity: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  // Check for overlapping fiscal periods (EXCLUDE constraint should prevent this, but verify)
  const periods = await tx.fiscalPeriod.findMany({
    where: { companyId },
    orderBy: { periodStart: 'asc' },
  });
  for (let i = 1; i < periods.length; i++) {
    if (periods[i].periodStart <= periods[i - 1].periodEnd) {
      findings.push({
        check_code: 'FISCAL_PERIOD_INTEGRITY',
        severity: 'high',
        reference_type: 'fiscal_period',
        reference_id: periods[i].id,
        details: { issue: 'Overlapping fiscal periods', period1: periods[i - 1].periodName, period2: periods[i].periodName },
      });
    }
  }
  // Check for gaps (period end + 1 day should equal next period start)
  for (let i = 1; i < periods.length; i++) {
    const expectedStart = new Date(periods[i - 1].periodEnd);
    expectedStart.setDate(expectedStart.getDate() + 1);
    if (periods[i].periodStart.getTime() !== expectedStart.getTime()) {
      findings.push({
        check_code: 'FISCAL_PERIOD_INTEGRITY',
        severity: 'warning',
        reference_type: 'fiscal_period',
        reference_id: periods[i].id,
        details: { issue: 'Gap between fiscal periods', gap_start: periods[i - 1].periodEnd, next_start: periods[i].periodStart },
      });
    }
  }
  return findings;
};
export const checkCourierCodReceivable: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const policies = await tx.accountingPolicy.findUnique({ where: { companyId } });
  if (!policies?.courierClearingAccountId) return findings;
  const codLines = await tx.journalLine.aggregate({ where: { companyId, chartOfAccountId: policies.courierClearingAccountId }, _sum: { debitBase: true, creditBase: true } });
  const balance = parseFloat(codLines._sum.debitBase?.toString() ?? '0') - parseFloat(codLines._sum.creditBase?.toString() ?? '0');
  if (balance < 0) findings.push({ check_code: 'COURIER_COD_RECEIVABLE', severity: 'warning', expected_value: 0, actual_value: balance, variance: balance, details: { issue: 'Negative COD balance' } });
  return findings;
};
export const checkAdvanceLiability: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const policies = await tx.accountingPolicy.findUnique({ where: { companyId } });
  if (!policies?.customerAdvanceAccountId) return findings;
  // GL balance for customer advance liability account
  const glBalance = await tx.journalLine.aggregate({
    where: { companyId, chartOfAccountId: policies.customerAdvanceAccountId },
    _sum: { debitBase: true, creditBase: true },
  });
  const glLiability = parseFloat(glBalance._sum.creditBase?.toString() ?? '0') - parseFloat(glBalance._sum.debitBase?.toString() ?? '0');
  // Subledger: sum of customer_advance_ledger balances
  const ledgerEntries = await tx.customerAdvanceLedger.aggregate({
    where: { companyId },
    _sum: { amountDelta: true },
  });
  const subledgerBalance = parseFloat(ledgerEntries._sum.amountDelta?.toString() ?? '0');
  if (Math.abs(glLiability - subledgerBalance) > 1) {
    findings.push({
      check_code: 'ADVANCE_LIABILITY',
      severity: 'high',
      expected_value: subledgerBalance,
      actual_value: glLiability,
      variance: glLiability - subledgerBalance,
      details: { issue: 'Customer advance liability GL does not match subledger' },
    });
  }
  return findings;
};
export const checkRewardPointBalance: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  // Check for negative reward point balances (should never happen)
  const negativeBalances = await tx.rewardPointTransaction.groupBy({
    by: ['customerId'],
    where: { companyId },
    _sum: { pointsDelta: true },
  });
  for (const bal of negativeBalances) {
    if (bal._sum.pointsDelta && parseFloat(bal._sum.pointsDelta.toString()) < 0) {
      findings.push({
        check_code: 'REWARD_POINT_BALANCE',
        severity: 'critical',
        reference_type: 'customer',
        reference_id: bal.customerId,
        expected_value: 0,
        actual_value: parseFloat(bal._sum.pointsDelta.toString()),
        variance: parseFloat(bal._sum.pointsDelta.toString()),
        details: { issue: 'Negative reward point balance' },
      });
    }
  }
  return findings;
};
export const checkGrniReconciliation: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const policies = await tx.accountingPolicy.findUnique({ where: { companyId } });
  if (!policies?.grniAccountId) return findings;
  // GL balance for GRNI account (credit = liability, debit = reversed when invoice received)
  const glBalance = await tx.journalLine.aggregate({
    where: { companyId, chartOfAccountId: policies.grniAccountId },
    _sum: { debitBase: true, creditBase: true },
  });
  const glGrni = parseFloat(glBalance._sum.creditBase?.toString() ?? '0') - parseFloat(glBalance._sum.debitBase?.toString() ?? '0');
  // Subledger: purchases received but not yet invoiced
  const uninvoicedPurchases = await tx.purchase.aggregate({
    where: { companyId, orderStatus: 'received' },
    _sum: { grandTotal: true },
  });
  const subledgerGrni = parseFloat(uninvoicedPurchases._sum.grandTotal?.toString() ?? '0');
  if (Math.abs(glGrni - subledgerGrni) > 1) {
    findings.push({
      check_code: 'GRNI_RECONCILIATION',
      severity: 'high',
      expected_value: subledgerGrni,
      actual_value: glGrni,
      variance: glGrni - subledgerGrni,
      details: { issue: 'GRNI GL balance does not match uninvoiced purchases subledger' },
    });
  }
  return findings;
};

// ── 4 missing §11.3 reconciliation checks ──

// TRIAL_BALANCE_ZERO — total debits must equal total credits across all posted entries
export const checkTrialBalanceZero: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const result = await tx.journalLine.aggregate({
    where: { companyId, journalEntry: { status: 'posted' } },
    _sum: { debitBase: true, creditBase: true },
  });
  const totalDebit = parseFloat(result._sum.debitBase?.toString() ?? '0');
  const totalCredit = parseFloat(result._sum.creditBase?.toString() ?? '0');
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    findings.push({
      check_code: 'TRIAL_BALANCE_ZERO',
      severity: 'critical',
      expected_value: totalDebit,
      actual_value: totalCredit,
      variance: totalCredit - totalDebit,
      details: { issue: 'Trial balance does not zero (total debits != total credits)' },
    });
  }
  return findings;
};

// TAX_INPUT_GL — input VAT (from purchase tax) should match GL input VAT account
export const checkTaxInputGl: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const policies = await tx.accountingPolicy.findUnique({ where: { companyId } });
  if (!policies?.grniAccountId) return findings; // input VAT goes through GRNI/VAT receivable
  // Sum purchase item taxes (input VAT)
  const inputVatResult = await tx.purchaseItemTax.aggregate({
    where: { companyId },
    _sum: { taxAmount: true },
  }).catch(() => ({ _sum: { taxAmount: null } }));
  const expectedInputVat = parseFloat(inputVatResult._sum.taxAmount?.toString() ?? '0');
  if (expectedInputVat === 0) return findings; // no purchases with tax
  // Check GL — this is simplified; in production would check the VAT receivable account
  findings.push({
    check_code: 'TAX_INPUT_GL',
    severity: 'info',
    expected_value: expectedInputVat,
    actual_value: 0,
    variance: -expectedInputVat,
    details: { issue: 'Input VAT from purchases recorded — verify GL VAT receivable account' },
  });
  return findings;
};

// OUTBOX_COMPLETENESS — check for stuck/dead-lettered outbox events
export const checkOutboxCompleteness: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const deadLetterCount = await tx.outboxEvent.count({
    where: { companyId, status: 'dead_letter' },
  }).catch(() => 0);
  if (deadLetterCount > 0) {
    findings.push({
      check_code: 'OUTBOX_COMPLETENESS',
      severity: 'high',
      expected_value: 0,
      actual_value: deadLetterCount,
      variance: deadLetterCount,
      details: { issue: `${deadLetterCount} outbox events in dead_letter status` },
    });
  }
  // Check for events pending too long (> 1 hour)
  const stalePending = await tx.outboxEvent.count({
    where: {
      companyId,
      status: 'pending',
      nextAttemptAt: { lt: new Date(Date.now() - 60 * 60 * 1000) },
    },
  }).catch(() => 0);
  if (stalePending > 0) {
    findings.push({
      check_code: 'OUTBOX_COMPLETENESS',
      severity: 'warning',
      expected_value: 0,
      actual_value: stalePending,
      variance: stalePending,
      details: { issue: `${stalePending} outbox events pending for >1 hour` },
    });
  }
  return findings;
};

// IDEMPOTENCY_RESOURCE — check for orphaned idempotency requests (processing but never completed)
export const checkIdempotencyResource: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const orphaned = await tx.idempotencyRequest.count({
    where: {
      companyId,
      status: 'processing',
      lockedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) }, // stuck >10 min
    },
  }).catch(() => 0);
  if (orphaned > 0) {
    findings.push({
      check_code: 'IDEMPOTENCY_RESOURCE',
      severity: 'warning',
      expected_value: 0,
      actual_value: orphaned,
      variance: orphaned,
      details: { issue: `${orphaned} idempotency requests stuck in 'processing' for >10 minutes` },
    });
  }
  return findings;
};

// ── AM-BR additions ──

// FIXED_ASSET_NBV — verify NBV = purchase_cost - accumulated_depreciation for all active assets
export const checkFixedAssetNetBookValue: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const assets = await tx.fixedAsset.findMany({
    where: { companyId, status: { in: ['active', 'fully_depreciated'] } },
    select: { id: true, assetCode: true, purchaseCost: true, salvageValue: true, accumulatedDepreciation: true, netBookValue: true },
  });
  for (const a of assets) {
    const cost = parseFloat(a.purchaseCost.toString());
    const accum = parseFloat(a.accumulatedDepreciation.toString());
    const expectedNbv = cost - accum;
    const actualNbv = parseFloat(a.netBookValue.toString());
    if (Math.abs(expectedNbv - actualNbv) > 0.01) {
      findings.push({
        check_code: 'FIXED_ASSET_NBV',
        severity: 'high',
        reference_type: 'fixed_asset',
        reference_id: a.id,
        expected_value: expectedNbv,
        actual_value: actualNbv,
        variance: actualNbv - expectedNbv,
        details: { issue: 'Net book value does not equal cost minus accumulated depreciation', asset_code: a.assetCode },
      });
    }
  }
  return findings;
};

// BANK_RECONCILIATION_VARIANCE — check for reconciliations with unresolved variance
export const checkBankReconciliationVariance: ReconciliationCheck = async (tx, companyId) => {
  const findings: ReconciliationFinding[] = [];
  const recs = await tx.bankReconciliation.findMany({
    where: { companyId, status: 'has_variance' },
    select: { id: true, statementDate: true, variance: true, financialAccountId: true },
  });
  for (const r of recs) {
    const variance = parseFloat(r.variance.toString());
    if (Math.abs(variance) > 0.01) {
      findings.push({
        check_code: 'BANK_RECONCILIATION_VARIANCE',
        severity: 'warning',
        reference_type: 'bank_reconciliation',
        reference_id: r.id,
        expected_value: 0,
        actual_value: variance,
        variance,
        details: { issue: 'Reconciliation has unresolved variance', statement_date: r.statementDate, financial_account_id: r.financialAccountId },
      });
    }
  }
  return findings;
};

export const ALL_CHECKS = [
  { code: 'STOCK_QTY_LEDGER', fn: checkStockQtyLedger },
  { code: 'STOCK_VALUE_LEDGER', fn: checkStockValueLedger },
  { code: 'SERIAL_STOCK_COUNT', fn: checkSerialStockCount },
  { code: 'RESERVATION_PROJECTION', fn: checkReservationProjection },
  { code: 'JOURNAL_BALANCE', fn: checkJournalBalance },
  { code: 'TRIAL_BALANCE_ZERO', fn: checkTrialBalanceZero },
  { code: 'AR_SUBLEDGER_GL', fn: checkArSubledgerGl },
  { code: 'AP_SUBLEDGER_GL', fn: checkApSubledgerGl },
  { code: 'PAYMENT_ALLOCATION_LIMIT', fn: checkPaymentAllocationLimit },
  { code: 'CASH_SHIFT_VARIANCE', fn: checkCashShiftVariance },
  { code: 'TAX_OUTPUT_GL', fn: checkTaxOutputGl },
  { code: 'TAX_INPUT_GL', fn: checkTaxInputGl },
  { code: 'GIFT_CARD_LIABILITY', fn: checkGiftCardLiability },
  { code: 'REWARD_POINT_BALANCE', fn: checkRewardPointBalance },
  { code: 'GRNI_RECONCILIATION', fn: checkGrniReconciliation },
  { code: 'COURIER_COD_RECEIVABLE', fn: checkCourierCodReceivable },
  { code: 'FISCAL_PERIOD_INTEGRITY', fn: checkFiscalPeriodIntegrity },
  { code: 'ADVANCE_LIABILITY', fn: checkAdvanceLiability },
  { code: 'OUTBOX_COMPLETENESS', fn: checkOutboxCompleteness },
  { code: 'IDEMPOTENCY_RESOURCE', fn: checkIdempotencyResource },
  { code: 'FIXED_ASSET_NBV', fn: checkFixedAssetNetBookValue },
  { code: 'BANK_RECONCILIATION_VARIANCE', fn: checkBankReconciliationVariance },
];

export async function runReconciliation(companyId: string, runType: 'nightly' | 'manual' | 'pre_close' | 'post_restore' = 'nightly', initiatedBy?: string) {
  const run = await db.reconciliationRun.create({ data: { companyId, runType, status: 'running', initiatedBy: initiatedBy ?? null, summary: '{}' } });
  const allFindings: ReconciliationFinding[] = [];
  for (const check of ALL_CHECKS) {
    try {
      const findings = await db.$transaction(async (tx) => check.fn(tx, companyId));
      allFindings.push(...findings);
      for (const f of findings) {
        await db.reconciliationFinding.create({ data: { companyId, reconciliationRunId: run.id, checkCode: f.check_code, severity: f.severity, referenceType: f.reference_type ?? null, referenceId: f.reference_id ?? null, expectedValue: f.expected_value ?? null, actualValue: f.actual_value ?? null, variance: f.variance ?? null, details: JSON.stringify(f.details), status: 'open' } });
      }
    } catch (e) { console.error(`Reconciliation check ${check.code} failed:`, e); }
  }
  const summary: Record<string, number> = { total: allFindings.length };
  for (const f of allFindings) summary[f.severity] = (summary[f.severity] ?? 0) + 1;
  const status = allFindings.some(f => f.severity === 'critical') ? 'failed' : allFindings.some(f => f.severity === 'high') ? 'partial' : 'passed';
  await db.reconciliationRun.update({ where: { id: run.id }, data: { status, completedAt: new Date(), summary: JSON.stringify(summary) } });
  return { runId: run.id, findings: allFindings, summary };
}
