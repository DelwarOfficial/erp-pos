// POST /api/v1/payments/{id}/refund — refund a payment via the payment provider

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { providerRegistry } from '@/adapters';
import { registerProviders } from '@/adapters/providers';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const RefundSchema = z.object({
  amount: z.number().positive(),
  provider_code: z.string().min(1),
  gateway_txn_id: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'payment.allocate');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = RefundSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/payments/${id}/refund`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'payment.refund', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const payment = await tx.payment.findFirst({
              where: { id, companyId: auth.companyId },
            });
            if (!payment) throw new DomainError('RESOURCE_NOT_FOUND', 'Payment not found', {}, 404);
            if (payment.paymentStatus === 'reversed') {
              throw new DomainError('VALIDATION_FAILED', 'Cannot refund a reversed payment', {}, 409);
            }
            if (body.amount > parseFloat(payment.amount.toString())) {
              throw new DomainError('VALIDATION_FAILED', 'Refund amount exceeds payment amount', {}, 400);
            }

            // Resolve provider
            registerProviders();
            const provider = providerRegistry.getPayment(body.provider_code);
            if (!provider) {
              throw new DomainError('VALIDATION_FAILED', `Payment provider '${body.provider_code}' not registered`, {}, 400);
            }

            const refundResult = await provider.refund({
              gatewayTxnId: body.gateway_txn_id,
              amount: body.amount,
            });

            // Record audit log
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'payment.refund', entityType: 'payment', entityId: payment.id,
                afterValue: JSON.stringify({
                  refund_id: refundResult.refundId, status: refundResult.status,
                  amount: body.amount, gateway_txn_id: body.gateway_txn_id,
                  reason: body.reason,
                }) },
            });

            return {
              status: 200,
              body: {
                payment_id: payment.id,
                refund_id: refundResult.refundId,
                refund_status: refundResult.status,
                amount: body.amount,
              },
              resourceType: 'payment_refund', resourceId: refundResult.refundId,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid refund payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
