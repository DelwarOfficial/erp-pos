// POST /api/v1/cashier-shifts/{id}/close

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, hasPermission, requirePermission } from '@/lib/auth/middleware';
import { requireMfaForAction } from '@/lib/auth/requireMfa';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { closeCashierShift } from '@/domain/commands/m3/CashierShift';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const CloseSchema = z.object({
  counted_closing_cash: z.number().min(0),
  variance_reason: z.string().max(500).optional(),
  approved_by: z.string().uuid().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'shift.close');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = CloseSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/cashier-shifts/${id}/close`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async (tx) =>
        withIdempotency(
          { idempotencyKey, operation: 'cashier_shift.close', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            // Who may approve is decided from the session for the shift's branch; an
            // approved_by in the body is ignored (it used to be trusted as given).
            const shiftRow = await tx.cashierShift.findFirst({ where: { id, companyId: auth.companyId }, select: { branchId: true } });
            const closerCanApprove = shiftRow ? await hasPermission(auth, 'approval.resolve', shiftRow.branchId) : false;
            const result = await closeCashierShift(tx, {
              shiftId: id,
              companyId: auth.companyId,
              closedBy: auth.userId,
              countedClosingCash: body.counted_closing_cash,
              varianceReason: body.variance_reason,
              closerCanApprove,
            }, correlationId);
            // A manager approving a large drawer variance re-verifies MFA.
            // Inside the transaction: a refusal undoes the close.
            const closed = await tx.cashierShift.findFirst({ where: { id, companyId: auth.companyId }, select: { approvedBy: true } });
            if (closed?.approvedBy) await requireMfaForAction(req, 'supervisor_cashier_variance_approval');
            return {
              status: 200,
              body: result,
              resourceType: 'cashier_shift',
              resourceId: id,
            };
          },
          tx,
        )),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid close shift payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
