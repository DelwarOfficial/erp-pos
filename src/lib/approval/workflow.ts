// src/lib/approval/workflow.ts
// Maker-checker approval workflow per §20.D04 + §20.0 Control #7.
// Creates and resolves approval_requests for sensitive operations.

import { db } from '@/lib/db';
import { DomainError } from '@/lib/errors/codes';
import { randomUUID } from 'node:crypto';

export interface CreateApprovalRequestParams {
  companyId: string;
  branchId?: string;
  requestType: string; // sale_void / expense / journal_adjustment / fiscal_period_unlock / tax_rule_change / courier_settlement_variance / large_refund / large_supplier_return / fefo_override / backdate
  referenceType: string; // sale / expense / journal_entry / fiscal_period / etc.
  referenceId: string;
  payload: Record<string, unknown>;
  requestedBy: string;
  reason?: string;
  thresholdValue?: number; // the value that exceeded the threshold
  thresholdName?: string; // which threshold was exceeded
}

export async function createApprovalRequest(params: CreateApprovalRequestParams) {
  const existing = await db.approvalRequest.findFirst({
    where: {
      companyId: params.companyId,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      status: 'pending',
    },
  });
  if (existing) {
    throw new DomainError('APPROVAL_REQUIRED', 'Approval already pending for this entity', { approval_request_id: existing.id }, 409);
  }

  return db.approvalRequest.create({
    data: {
      id: randomUUID(),
      companyId: params.companyId,
      branchId: params.branchId ?? null,
      requestType: params.requestType,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      requestedBy: params.requestedBy,
      status: 'pending',
      reason: params.reason ?? 'Approval required',
      payload: JSON.stringify(params.payload),
      requestedAt: new Date(),
    },
  });
}

export async function resolveApprovalRequest(params: {
  approvalRequestId: string;
  companyId: string;
  resolvedBy: string;
  decision: 'approved' | 'rejected';
  reason?: string;
}) {
  const request = await db.approvalRequest.findFirst({
    where: { id: params.approvalRequestId, companyId: params.companyId },
  });
  if (!request) throw new DomainError('RESOURCE_NOT_FOUND', 'Approval request not found', {}, 404);
  if (request.status !== 'pending') throw new DomainError('VALIDATION_FAILED', `Approval already ${request.status}`, {}, 409);

  // §20.0 Control #10: maker ≠ checker
  if (request.requestedBy === params.resolvedBy) {
    throw new DomainError('SELF_APPROVAL_PROHIBITED', 'You cannot approve/reject your own request', { requested_by: request.requestedBy }, 403);
  }

  return db.approvalRequest.update({
    where: { id: params.approvalRequestId },
    data: {
      status: params.decision,
      approvedBy: params.resolvedBy,
      resolvedAt: new Date(),
      reason: params.reason ?? (request.reason ?? 'Resolved'),
    },
  });
}

export async function checkApprovalRequired(params: {
  companyId: string;
  referenceType: string;
  referenceId: string;
}): Promise<boolean> {
  const pending = await db.approvalRequest.findFirst({
    where: {
      companyId: params.companyId,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      status: 'pending',
    },
  });
  return !!pending;
}

export async function isApproved(params: {
  companyId: string;
  referenceType: string;
  referenceId: string;
}): Promise<boolean> {
  const approved = await db.approvalRequest.findFirst({
    where: {
      companyId: params.companyId,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      status: 'approved',
    },
    orderBy: { resolvedAt: 'desc' },
  });
  return !!approved;
}
