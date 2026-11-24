// POST /api/v1/payments/{id}/cheque/clear — the bank cleared a received cheque.
// Moves it from cheque clearing to the payment's cash/bank account (red-team
// workstream 8).

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { assertBranchAccess } from '@/lib/db/branchScope';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { clearCheque } from '@/domain/commands/m3/Payments';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'cheque.clear');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/payments/${id}/cheque/clear`, body: {} });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async (tx) => {
        const payment = await tx.payment.findFirst({ where: { id, companyId: auth.companyId }, select: { branchId: true } });
        if (!payment) throw new DomainError('RESOURCE_NOT_FOUND', 'Payment not found', {}, 404);
        assertBranchAccess(payment.branchId, auth.ctx);
        return withIdempotency(
          { idempotencyKey, operation: 'cheque.clear', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const out = await clearCheque(tx, { companyId: auth.companyId, paymentId: id, clearedBy: auth.userId }, correlationId);
            return { status: 200, body: { payment_id: out.paymentId, cheque_status: out.chequeStatus }, resourceType: 'payment', resourceId: id };
          },
          tx,
        );
      }),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
