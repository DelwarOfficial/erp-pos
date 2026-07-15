// src/lib/approval/thresholds.ts
// Tenant-configurable approval thresholds per §20.D04.
// Loads thresholds from configuration_values (keyed by configuration_definitions).
// Falls back to sensible defaults if not configured.

import { db } from '@/lib/db';

export interface ApprovalThresholds {
  sale_void_hours: number;
  sale_discount_threshold: number;
  cashier_variance_amount: number;
  cashier_variance_percent: number;
  journal_adjustment_threshold: number;
  expense_approval_threshold: number;
  refund_approval_threshold: number;
  supplier_return_approval_threshold: number;
  stock_backdate_days: number;
}

const DEFAULTS: ApprovalThresholds = {
  sale_void_hours: 24,
  sale_discount_threshold: 1000,
  cashier_variance_amount: 500,
  cashier_variance_percent: 5,
  journal_adjustment_threshold: 50000,
  expense_approval_threshold: 10000,
  refund_approval_threshold: 5000,
  supplier_return_approval_threshold: 20000,
  stock_backdate_days: 7,
};

const cache = new Map<string, { thresholds: ApprovalThresholds; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getApprovalThresholds(companyId: string): Promise<ApprovalThresholds> {
  const cached = cache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) return cached.thresholds;

  const thresholds = { ...DEFAULTS };
  try {
    const configValues = await db.configurationValue.findMany({
      where: { companyId },
      include: { definition: { select: { key: true } } },
    });
    const configMap: Record<string, string> = {};
    for (const cv of configValues) configMap[cv.definition.key] = cv.value;

    if (configMap['sale.void_hours']) thresholds.sale_void_hours = parseInt(configMap['sale.void_hours'], 10);
    if (configMap['sale.discount_threshold']) thresholds.sale_discount_threshold = parseFloat(configMap['sale.discount_threshold']);
    if (configMap['cashier.variance_amount']) thresholds.cashier_variance_amount = parseFloat(configMap['cashier.variance_amount']);
    if (configMap['cashier.variance_percent']) thresholds.cashier_variance_percent = parseFloat(configMap['cashier.variance_percent']);
    if (configMap['journal.adjustment_threshold']) thresholds.journal_adjustment_threshold = parseFloat(configMap['journal.adjustment_threshold']);
    if (configMap['expense.approval_threshold']) thresholds.expense_approval_threshold = parseFloat(configMap['expense.approval_threshold']);
    if (configMap['refund.approval_threshold']) thresholds.refund_approval_threshold = parseFloat(configMap['refund.approval_threshold']);
    if (configMap['supplier_return.approval_threshold']) thresholds.supplier_return_approval_threshold = parseFloat(configMap['supplier_return.approval_threshold']);
    if (configMap['stock.backdate_days']) thresholds.stock_backdate_days = parseInt(configMap['stock.backdate_days'], 10);
  } catch { /* fall back to defaults */ }

  cache.set(companyId, { thresholds, expiresAt: Date.now() + CACHE_TTL_MS });
  return thresholds;
}

export function clearThresholdCache(companyId?: string): void {
  if (companyId) cache.delete(companyId); else cache.clear();
}

export function requiresApproval(value: number, threshold: number): boolean {
  return Math.abs(value) > threshold;
}
