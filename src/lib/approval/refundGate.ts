// src/lib/approval/refundGate.ts
// Large-refund control for the manual channels (red-team workstream 1):
// POST /api/v1/sale-returns and POST /api/v1/payments with sale_refund.
//
// Once a sale's cumulative return credit or cumulative cash refund reaches
// refund_approval_threshold (base currency), the caller must:
//   1. hold a fresh MFA session (step-up, 'large_refund_approval'), and
//   2. present an approved ApprovalRequest with
//        request_type   'large_refund'
//        reference_type 'sale', reference_id = the sale
//        payload        { "refund_total": <largest cumulative base amount> }
//      resolved by a user other than the caller.
//
// The approval caps the sale's cumulative total, so reusing it cannot
// release more than was approved, and splitting one refund into several
// below-threshold pieces on the same sale does not avoid it. Maker != checker
// at resolve time is enforced by resolveApprovalRequest; this adds
// approver != the user moving the money.

import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { getApprovalThresholds } from '@/lib/approval/thresholds';
import { requireMfaForAction } from '@/lib/auth/requireMfa';
import { DomainError } from '@/lib/errors/codes';

export const LARGE_REFUND_REQUEST_TYPE = 'large_refund';

export interface RefundGateResult {
  threshold: number;
  totalBase: string;
  approvalRequestId?: string;
  approvedBy?: string;
}

export async function enforceLargeRefundGate(
  tx: Prisma.TransactionClient,
  req: NextRequest,
  params: {
    companyId: string;
    userId: string;
    saleId: string;
    /** The sale's cumulative total in base currency, including this operation. */
    totalBase: Prisma.Decimal;
    approvalRequestId?: string;
  },
): Promise<RefundGateResult> {
  const { refund_approval_threshold: threshold } = await getApprovalThresholds(params.companyId);
  const totalBase = params.totalBase.toDecimalPlaces(2);
  const result: RefundGateResult = { threshold, totalBase: totalBase.toFixed(2) };
  if (totalBase.lt(threshold)) return result;

  const details = {
    threshold, amount_base: result.totalBase,
    request_type: LARGE_REFUND_REQUEST_TYPE, reference_type: 'sale', reference_id: params.saleId,
  };
  await requireMfaForAction(req, 'large_refund_approval');

  if (!params.approvalRequestId) {
    throw new DomainError('APPROVAL_REQUIRED',
      `Refunds of ${threshold} or more on one sale need a manager's approval. Ask a manager to approve, then try again with the approval.`,
      details, 403);
  }
  const approval = await tx.approvalRequest.findFirst({
    where: {
      id: params.approvalRequestId, companyId: params.companyId,
      requestType: LARGE_REFUND_REQUEST_TYPE, referenceType: 'sale', referenceId: params.saleId,
    },
  });
  if (!approval || approval.status !== 'approved' || !approval.approvedBy) {
    throw new DomainError('APPROVAL_REQUIRED', 'No approved large-refund request for this sale', details, 403);
  }
  if (approval.approvedBy === params.userId) {
    throw new DomainError('SELF_APPROVAL_PROHIBITED', 'A different user must approve this refund', { approval_request_id: approval.id }, 403);
  }
  let approvedTotal: Prisma.Decimal | null = null;
  try {
    const raw = (JSON.parse(approval.payload) as { refund_total?: unknown }).refund_total;
    if (typeof raw === 'number' || (typeof raw === 'string' && /^\d{1,12}(\.\d{1,2})?$/.test(raw))) approvedTotal = new Prisma.Decimal(raw);
  } catch { /* unreadable payload: treated as no amount approved */ }
  if (!approvedTotal || approvedTotal.lt(totalBase)) {
    throw new DomainError('APPROVAL_REQUIRED',
      `The approval covers ${approvedTotal ? approvedTotal.toFixed(2) : 'no amount'}; this sale's refunds would total ${result.totalBase}`,
      { ...details, approved_total: approvedTotal?.toFixed(2) ?? null, approval_request_id: approval.id }, 403);
  }
  return { ...result, approvalRequestId: approval.id, approvedBy: approval.approvedBy };
}
