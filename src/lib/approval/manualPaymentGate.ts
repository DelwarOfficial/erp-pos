// src/lib/approval/manualPaymentGate.ts
// Outgoing manual payments with no customer or supplier (red-team
// workstream 2): money leaving with nothing to show for it needs a second
// person. The caller presents an approved ApprovalRequest with
//   request_type   'manual_payment'
//   reference_type 'payment', reference_id = a new UUID chosen by the requester
//   payload        { "amount": <base amount>, "payment_type": "<type>" }
// resolved by a user other than the caller.
//
// The reference_id becomes the payment's client_txn_id, which is unique per
// company, so one approval releases exactly one payment.

import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';

export const MANUAL_PAYMENT_REQUEST_TYPE = 'manual_payment';

export async function enforceManualPaymentApproval(
  tx: Prisma.TransactionClient,
  params: {
    companyId: string; branchId: string; userId: string; paymentType: string;
    amountBase: Prisma.Decimal; approvalRequestId?: string;
  },
): Promise<{ approvalRequestId: string; approvedBy: string; clientTxnId: string }> {
  const details = {
    request_type: MANUAL_PAYMENT_REQUEST_TYPE, reference_type: 'payment',
    amount_base: params.amountBase.toFixed(2), payment_type: params.paymentType,
  };
  if (!params.approvalRequestId) {
    throw new DomainError('APPROVAL_REQUIRED',
      'Money paid out with no customer or supplier needs a manager\'s approval. Choose who it was paid to, or ask a manager to approve it.',
      details, 403);
  }
  const approval = await tx.approvalRequest.findFirst({
    where: { id: params.approvalRequestId, companyId: params.companyId, requestType: MANUAL_PAYMENT_REQUEST_TYPE, referenceType: 'payment' },
  });
  if (!approval || approval.status !== 'approved' || !approval.approvedBy) {
    throw new DomainError('APPROVAL_REQUIRED', 'No approved request for this payment', details, 403);
  }
  if (approval.approvedBy === params.userId) {
    throw new DomainError('SELF_APPROVAL_PROHIBITED', 'A different user must approve this payment', { approval_request_id: approval.id }, 403);
  }
  if (approval.branchId && approval.branchId !== params.branchId) {
    throw new DomainError('APPROVAL_REQUIRED', 'The approval is for another branch', { ...details, approval_request_id: approval.id }, 403);
  }
  let payload: { amount?: unknown; payment_type?: unknown } = {};
  try { payload = JSON.parse(approval.payload); } catch { /* unreadable: nothing approved */ }
  const raw = payload.amount;
  const approved = typeof raw === 'number' || (typeof raw === 'string' && /^\d{1,12}(\.\d{1,2})?$/.test(raw)) ? new Prisma.Decimal(raw) : null;
  if (!approved || approved.lt(params.amountBase) || payload.payment_type !== params.paymentType) {
    throw new DomainError('APPROVAL_REQUIRED',
      `The approval does not cover this payment (approved ${approved ? approved.toFixed(2) : 'no amount'} as ${String(payload.payment_type ?? 'unknown')})`,
      { ...details, approval_request_id: approval.id }, 403);
  }
  const used = await tx.payment.findFirst({ where: { companyId: params.companyId, clientTxnId: approval.referenceId }, select: { id: true } });
  if (used) throw new DomainError('VALIDATION_FAILED', 'This approval has already been used for a payment', { approval_request_id: approval.id }, 409);
  return { approvalRequestId: approval.id, approvedBy: approval.approvedBy, clientTxnId: approval.referenceId };
}
