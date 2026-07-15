// POST /api/v1/approvals/[id]/resolve — approve or reject an approval request
// Per §20.0 Control #7 + #10 — maker ≠ checker enforcement

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { resolveApprovalRequest } from '@/lib/approval/workflow';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { requireMfaForAction } from '@/lib/auth/requireMfa';
import { z } from 'zod';

const ResolveSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requireMfaForAction(req, 'journal_adjustment_approval');
    await requirePermission(auth, 'approval.resolve');

    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = ResolveSchema.parse(await req.json());

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'approval.resolve', requestHash: computeRequestHash({ method: 'POST', path: `/api/v1/approvals/${id}/resolve`, body }), companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const resolved = await resolveApprovalRequest({
              approvalRequestId: id,
              companyId: auth.companyId,
              resolvedBy: auth.userId!,
              decision: body.decision,
              reason: body.reason,
            });
            return { status: 200, body: { item: resolved }, resourceType: 'approval_request', resourceId: id };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid resolve payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
