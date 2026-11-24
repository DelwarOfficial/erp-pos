// POST /api/v1/payments/{id}/cheque/bounce — a received cheque bounced.
// Reverses what it settled out of cheque clearing and marks the payment
// reversed, so the customer owes the money again (red-team workstream 8).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { assertBranchAccess } from '@/lib/db/branchScope';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { bounceCheque } from '@/domain/commands/m3/Payments';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const BounceSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'cheque.bounce');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = BounceSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/payments/${id}/cheque/bounce`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async (tx) => {
        const payment = await tx.payment.findFirst({ where: { id, companyId: auth.companyId }, select: { branchId: true } });
        if (!payment) throw new DomainError('RESOURCE_NOT_FOUND', 'Payment not found', {}, 404);
        assertBranchAccess(payment.branchId, auth.ctx);
        return withIdempotency(
          { idempotencyKey, operation: 'cheque.bounce', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const out = await bounceCheque(tx, { companyId: auth.companyId, paymentId: id, bouncedBy: auth.userId, reason: body.reason }, correlationId);
            return { status: 200, body: { payment_id: out.paymentId, cheque_status: out.chequeStatus, payment_status: 'reversed' }, resourceType: 'payment', resourceId: id };
          },
          tx,
        );
      }),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Give a reason for the bounce', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
