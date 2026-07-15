// POST /api/v1/expenses/[id]/approve — approve a pending expense (maker-checker workflow)
// Per §20.0 Control #7 + #10 — maker ≠ checker enforcement.
// Per §21.14 — high-risk financial action requires MFA re-verification.
//
// CSRF protection is enforced globally by src/middleware.ts (Origin/Referer
// match OR X-CSRF-Token double-submit) for all cookie-auth mutations, so this
// handler does not re-implement the check.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { requireMfaForAction } from '@/lib/auth/requireMfa';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

// Body is optional; only `notes` is consumed. Unknown keys (e.g. `decision`)
// are tolerated for UI backward-compatibility — this endpoint always approves.
const ApproveSchema = z.object({
  notes: z.string().max(1000).optional(),
});

// Expense statuses that may transition into 'approved' via this endpoint.
// 'approved' / 'posted' / 'rejected' / 'voided' are terminal or post-approval.
const APPROVABLE_STATUSES = new Set(['draft', 'pending_approval']);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    // 1. Authenticate the caller (throws UNAUTHORIZED on failure).
    const auth = await authenticateRequest();

    // 2. High-risk financial approval — require MFA re-verification per §21.14.
    //    Uses the 'journal_adjustment_approval' action class, which is the
    //    closest defined MFA-required action for financial approvals.
    await requireMfaForAction(req, 'journal_adjustment_approval');

    // 3. Permission check — 'expense.approve' grants the approval capability.
    //    Branch scoping is enforced below once the expense's branchId is known.
    await requirePermission(auth, 'expense.approve');

    const { id } = await params;

    // 4. Idempotency-Key is mandatory for all mutations per §5.3.
    const idempotencyKey = requireIdempotencyKey(req);

    // 5. Parse + validate the optional body. Empty body is allowed; the UI
    //    currently sends `{ decision: 'approved' }`, which is tolerated.
    const rawBody = await req.json().catch(() => ({}));
    const body = ApproveSchema.parse(rawBody ?? {});

    const requestHash = computeRequestHash({
      method: 'POST',
      path: `/api/v1/expenses/${id}/approve`,
      body,
    });

    // 6. Run inside tenant context (AsyncLocalStorage) so the idempotency
    //    helper can read company/user. The actual work runs in a serializable
    //    Prisma transaction via withTenant.
    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        {
          idempotencyKey,
          operation: 'expense.approve',
          requestHash,
          companyId: auth.companyId,
          userId: auth.userId,
        },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // 7. Fetch the expense, scoped to the caller's company (RLS-equivalent).
            const expense = await tx.expense.findFirst({
              where: { id, companyId: auth.companyId },
            });
            if (!expense) {
              throw new DomainError(
                'RESOURCE_NOT_FOUND',
                'Expense not found',
                { expense_id: id },
                404,
              );
            }

            // 8. Branch access control — non-global users may only approve
            //    expenses in branches they are scoped to.
            if (!auth.isGlobal && !auth.branchIds.includes(expense.branchId)) {
              throw new DomainError(
                'FORBIDDEN_SCOPE',
                'Branch access denied for this expense',
                { branch_id: expense.branchId },
                403,
              );
            }

            // 9. State guard — only draft / pending_approval expenses can be
            //    approved. Other statuses are terminal or post-approval.
            if (!APPROVABLE_STATUSES.has(expense.status)) {
              throw new DomainError(
                'VALIDATION_FAILED',
                `Expense cannot be approved from status '${expense.status}'`,
                { expense_id: id, current_status: expense.status },
                409,
              );
            }

            // 10. Maker ≠ checker — the original requester cannot approve
            //     their own expense submission (§20.0 Control #10).
            if (expense.requestedBy === auth.userId) {
              throw new DomainError(
                'SELF_APPROVAL_PROHIBITED',
                'You cannot approve an expense you submitted',
                { requested_by: expense.requestedBy },
                403,
              );
            }

            const now = new Date();

            // 11. Update the expense — set status to 'approved' and record
            //     the approver. The Expense model has no dedicated
            //     approved_at column; the approval timestamp is captured in
            //     the audit log below and on the linked approval_request's
            //     resolvedAt field.
            const updated = await tx.expense.update({
              where: { id: expense.id },
              data: {
                status: 'approved',
                approvedBy: auth.userId,
              },
            });

            // 12. Resolve the linked approval_request if one is still pending.
            //     Done inside the same tx so the expense + approval request
            //     transition atomically (the shared resolveApprovalRequest
            //     helper uses the unrestricted db client and would escape
            //     this transaction). Skipped if no request is linked or the
            //     request is already resolved.
            let approvalRequestResolved = false;
            if (expense.approvalRequestId) {
              const ar = await tx.approvalRequest.findFirst({
                where: { id: expense.approvalRequestId, companyId: auth.companyId },
              });
              if (ar && ar.status === 'pending') {
                // Defence-in-depth maker ≠ checker check on the approval request.
                if (ar.requestedBy === auth.userId) {
                  throw new DomainError(
                    'SELF_APPROVAL_PROHIBITED',
                    'You cannot approve an approval request you submitted',
                    { requested_by: ar.requestedBy },
                    403,
                  );
                }
                await tx.approvalRequest.update({
                  where: { id: ar.id },
                  data: {
                    status: 'approved',
                    approvedBy: auth.userId,
                    resolvedAt: now,
                    // Preserve the original reason if no new notes are provided
                    // (ApprovalRequest.reason is non-nullable in the schema).
                    reason: body.notes ?? ar.reason,
                  },
                });
                approvalRequestResolved = true;
              }
            }

            // 13. Append-only audit log capturing the state transition.
            await tx.auditLog.create({
              data: {
                companyId: auth.companyId,
                userId: auth.userId!,
                correlationId,
                action: 'expense.approve',
                entityType: 'expense',
                entityId: expense.id,
                beforeValue: JSON.stringify({ status: expense.status }),
                afterValue: JSON.stringify({
                  status: 'approved',
                  approved_by: auth.userId,
                  approved_at: now.toISOString(),
                  notes: body.notes ?? null,
                  approval_request_resolved: approvalRequestResolved,
                }),
              },
            });

            return {
              status: 200,
              body: {
                id: updated.id,
                reference_no: updated.referenceNo,
                status: updated.status,
                approved_by: updated.approvedBy,
                approved_at: now.toISOString(),
                approval_request_id: updated.approvalRequestId,
                approval_request_resolved: approvalRequestResolved,
              },
              resourceType: 'expense',
              resourceId: updated.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(
        new DomainError(
          'VALIDATION_FAILED',
          'Invalid approve payload',
          { issues: e.issues },
          400,
        ),
        correlationId,
      );
    }
    return errorResponse(e, correlationId);
  }
}
