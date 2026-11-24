// src/lib/approval/cumulative.ts
// Cumulative approval thresholds (red-team workstream 7).
//
// Each thresholded action (manual journal, expense, gateway refund) used to
// compare one operation with its threshold, so one 50,000 journal posted as
// ten 49,999 ones never needed an approver. Here the actor's own operations of
// the same type over the last 24 hours are added to the new one, and the
// approval rule applies once that running total crosses the threshold.
// Below it, single-operation behaviour is unchanged. Totals are per user:
// other users' operations never count toward someone's total.

import { Prisma } from '@prisma/client';

export const CUMULATIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type CumulativeKind = 'journal' | 'expense' | 'refund';

type Client = Pick<Prisma.TransactionClient, 'journalLine' | 'expense' | 'payment'>;

/** Base-currency total of the actor's operations of this kind in the window, not counting the new one. */
export async function actorWindowTotal(client: Client, kind: CumulativeKind, companyId: string, userId: string, now = new Date()): Promise<Prisma.Decimal> {
  const since = new Date(now.getTime() - CUMULATIVE_WINDOW_MS);
  let sum: Prisma.Decimal | null | undefined;
  if (kind === 'journal') {
    // Manual adjustments only; journals posted by sales, expenses and the
    // like have their own controls.
    sum = (await client.journalLine.aggregate({
      where: { companyId, journalEntry: { companyId, sourceType: 'manual', createdBy: userId, createdAt: { gte: since } } },
      _sum: { debitBase: true },
    }))._sum.debitBase;
  } else if (kind === 'expense') {
    // A rejected or voided expense moved no money.
    sum = (await client.expense.aggregate({
      where: { companyId, requestedBy: userId, createdAt: { gte: since }, status: { notIn: ['rejected', 'voided'] } },
      _sum: { baseGrandTotal: true },
    }))._sum.baseGrandTotal;
  } else {
    // A pending gateway refund may still pay out; only a failed one does not.
    sum = (await client.payment.aggregate({
      where: { companyId, createdBy: userId, paymentType: 'sale_refund', direction: 'outgoing', createdAt: { gte: since }, paymentStatus: { not: 'failed' } },
      _sum: { baseAmount: true },
    }))._sum.baseAmount;
  }
  return new Prisma.Decimal(sum ?? 0);
}

export interface CumulativeCheck {
  /** True when this operation, added to the actor's window total, crosses the threshold. */
  required: boolean;
  /** Whether the operation alone is over the threshold (the old rule). */
  single: boolean;
  /** The actor's window total including this operation, base currency, 2 dp. */
  cumulative: string;
  threshold: number;
}

export async function checkCumulativeThreshold(client: Client, kind: CumulativeKind, params: {
  companyId: string; userId: string; amountBase: Prisma.Decimal; threshold: number; now?: Date;
}): Promise<CumulativeCheck> {
  const prior = await actorWindowTotal(client, kind, params.companyId, params.userId, params.now);
  const cumulative = prior.plus(params.amountBase).toDecimalPlaces(2);
  const single = params.amountBase.gt(params.threshold);
  return { required: single || cumulative.gt(params.threshold), single, cumulative: cumulative.toFixed(2), threshold: params.threshold };
}

/** Audit row written when the cumulative rule, not the single amount, called for approval. */
export function cumulativeAuditData(params: {
  companyId: string; userId: string; correlationId: string; kind: CumulativeKind;
  entityType: string; entityId: string; check: CumulativeCheck; amountBase: Prisma.Decimal;
}) {
  return {
    companyId: params.companyId, userId: params.userId, correlationId: params.correlationId,
    action: 'approval.cumulative_threshold', entityType: params.entityType, entityId: params.entityId,
    afterValue: JSON.stringify({
      kind: params.kind, amount_base: params.amountBase.toFixed(2), cumulative_base: params.check.cumulative,
      threshold: params.check.threshold, window_hours: CUMULATIVE_WINDOW_MS / 3_600_000,
    }),
  };
}
