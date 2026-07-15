// POST /api/v1/payments/{id}/reverse — reverse a posted payment (uses reversePayment)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { reversePayment } from '@/domain/commands/m3/Payments';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const ReverseSchema = z.object({ reason: z.string().min(1).max(500) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'payment.allocate');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = ReverseSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/payments/${id}/reverse`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'payment.reverse', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const out = await reversePayment(tx, {
              companyId: auth.companyId, paymentId: id,
              reversedBy: auth.userId, reason: body.reason,
            }, correlationId);
            return {
              status: 200,
              body: { reversed_payment_id: out.reversedPaymentId, original_payment_id: id, reason: body.reason },
              resourceType: 'payment', resourceId: out.reversedPaymentId,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid reverse payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
