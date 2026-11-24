// src/domain/refunds/saleRefunds.ts
// One view of what a sale has collected and refunded, shared by every refund
// path (red-team workstream 6).
//
// Gateway refunds (POST /payments/{id}/refund) link reversed_payment_id to the
// payment they refund. Manual refunds (POST /payments, sale_refund) link the
// sale return, and now also reversed_payment_id when one payment covers them.
// The two caps used to count disjoint rows, so one payment could be refunded
// once through each path. Here a refund row counts if it is linked either way,
// once, whatever its status except failed (a pending gateway refund holds its
// amount until it settles).

import { Prisma } from '@prisma/client';

export interface SaleRefundState {
  /** Money collected on the sale: allocations of posted payments. */
  paid: Prisma.Decimal;
  /** Every refund linked to the sale, by either path. */
  refunded: Prisma.Decimal;
  /** The sale's payments, each with what is still refundable from it. */
  payments: Array<{ id: string; method: string; amount: Prisma.Decimal; remaining: Prisma.Decimal }>;
}

export async function saleRefundState(tx: Prisma.TransactionClient, companyId: string, saleId: string): Promise<SaleRefundState> {
  const allocations = await tx.paymentAllocation.findMany({
    where: { companyId, saleId, payment: { paymentStatus: 'posted' } },
    select: { allocatedAmount: true, payment: { select: { id: true, amount: true, paymentMethod: true } } },
  });
  const paymentIds = [...new Set(allocations.map(a => a.payment.id))];
  const refunds = await tx.payment.findMany({
    where: { companyId, paymentType: 'sale_refund', direction: 'outgoing', paymentStatus: { not: 'failed' },
      OR: [{ reversedPaymentId: { in: paymentIds } }, { saleReturn: { saleId } }] },
    select: { id: true, amount: true, reversedPaymentId: true },
  });
  const zero = new Prisma.Decimal(0);
  const paid = allocations.reduce((sum, a) => sum.plus(a.allocatedAmount), zero);
  const refunded = refunds.reduce((sum, r) => sum.plus(r.amount), zero);
  const seen = new Set<string>();
  const payments = allocations.flatMap(a => {
    if (seen.has(a.payment.id)) return [];
    seen.add(a.payment.id);
    const against = refunds.filter(r => r.reversedPaymentId === a.payment.id).reduce((sum, r) => sum.plus(r.amount), zero);
    return [{ id: a.payment.id, method: a.payment.paymentMethod, amount: new Prisma.Decimal(a.payment.amount), remaining: new Prisma.Decimal(a.payment.amount).minus(against) }];
  });
  return { paid, refunded, payments };
}

/** The payment a manual refund reverses: one that alone covers it, the same method first. */
export function paymentToReverse(state: SaleRefundState, amount: Prisma.Decimal, method: string): string | null {
  const covering = state.payments.filter(p => p.remaining.gte(amount));
  return (covering.find(p => p.method === method) ?? covering[0])?.id ?? null;
}
