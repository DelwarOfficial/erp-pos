// POST /api/v1/payments/{id}/refund — refund a payment via the payment provider
//
// §22 REDTEAM refactor: external gateway call moved OUT of the DB transaction.
// Pattern (post-commit outbox):
//   1. BEGIN tx → validate payment + record audit intent → COMMIT
//   2. Fetch payment row (unscoped, for field reads) + call provider.refund() OUTSIDE tx
//   3. On success: create reversal payment record + audit (new short tx)
//   4. On failure: record audit with error
//
// This prevents long-held DB locks during network calls and keeps the
// transaction boundary tight (per §2 Design Principles: external network
// calls never occur inside a database transaction).

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
import { randomUUID } from 'node:crypto';

const RefundSchema = z.object({
  amount: z.number().positive(),
  provider_code: z.string().min(1),
  gateway_txn_id: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  const { id } = await params;
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'payment.allocate');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = RefundSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/payments/${id}/refund`, body });

    // ── Phase 1: Validate + record refund intent INSIDE a transaction ──
    // No external calls — just DB validation + audit log that commits atomically.
    await runInTenantContext(auth.ctx, () =>
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

            // Validate provider exists (cheap registry lookup, no network call)
            registerProviders();
            const provider = providerRegistry.getPayment(body.provider_code);
            if (!provider) {
              throw new DomainError('VALIDATION_FAILED', `Payment provider '${body.provider_code}' not registered`, {}, 400);
            }

            // Record audit log for refund intent
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'payment.refund.requested', entityType: 'payment', entityId: payment.id,
                afterValue: JSON.stringify({
                  amount: body.amount, gateway_txn_id: body.gateway_txn_id,
                  reason: body.reason, status: 'pending_gateway',
                }) },
              });

            return { status: 200, body: { ok: true }, resourceType: 'payment_refund', resourceId: payment.id };
          });
        },
      ),
    );

    // ── Phase 2: Fetch payment + call gateway OUTSIDE the transaction ──
    // Network call does not hold any DB locks.
    registerProviders();
    const provider = providerRegistry.getPayment(body.provider_code);
    if (!provider) {
      throw new DomainError('VALIDATION_FAILED', `Payment provider '${body.provider_code}' not registered`, {}, 400);
    }

    // Fetch the payment row (for field reads in phase 3). Use unrestricted db
    // since we already validated ownership in phase 1 and the idempotency key
    // prevents replays.
    const payment = await db.payment.findFirst({ where: { id, companyId: auth.companyId } });
    if (!payment) throw new DomainError('RESOURCE_NOT_FOUND', 'Payment not found', {}, 404);

    try {
      const refundResult = await provider.refund({
        gatewayTxnId: body.gateway_txn_id,
        amount: body.amount,
      });

      // ── Phase 3: Record refund result in a new short transaction ──
      // Create a reversal payment record + audit log
      const reversalPayment = await db.payment.create({
        data: {
          companyId: auth.companyId, branchId: payment.branchId,
          referenceNo: `REFUND-${payment.referenceNo}`, clientTxnId: randomUUID(),
          paymentType: 'sale_refund', direction: 'outgoing',
          customerId: payment.customerId ?? null,
          saleReturnId: payment.saleReturnId ?? null,
          financialAccountId: payment.financialAccountId,
          cashierShiftId: payment.cashierShiftId ?? null,
          currencyCode: payment.currencyCode, exchangeRate: payment.exchangeRate,
          amount: body.amount, baseAmount: body.amount,
          paymentMethod: body.provider_code, methodReference: refundResult.refundId,
          chequeStatus: 'not_applicable',
          paymentStatus: refundResult.status === 'completed' ? 'posted' : 'failed',
          businessDate: new Date(), receivedOrPaidAt: new Date(),
          reversedPaymentId: payment.id,
          createdBy: auth.userId!, notes: `Refund: ${body.reason ?? 'customer request'}`,
        },
      });

      await db.auditLog.create({
        data: { companyId: auth.companyId, userId: auth.userId, correlationId,
          action: 'payment.refund.completed', entityType: 'payment', entityId: payment.id,
          afterValue: JSON.stringify({
            refund_id: refundResult.refundId, refund_status: refundResult.status,
            reversal_payment_id: reversalPayment.id,
            amount: body.amount, gateway_txn_id: body.gateway_txn_id,
            reason: body.reason,
          }) },
      });

      return NextResponse.json({
        payment_id: payment.id,
        refund_id: refundResult.refundId,
        refund_status: refundResult.status,
        reversal_payment_id: reversalPayment.id,
        amount: body.amount,
      }, { status: 200 });
    } catch (gatewayError) {
      // Gateway call failed — record audit with error
      const errorMsg = gatewayError instanceof Error ? gatewayError.message : 'Unknown gateway error';
      await db.auditLog.create({
        data: { companyId: auth.companyId, userId: auth.userId, correlationId,
          action: 'payment.refund.failed', entityType: 'payment', entityId: payment.id,
          afterValue: JSON.stringify({
            provider: body.provider_code, error: errorMsg,
            amount: body.amount, gateway_txn_id: body.gateway_txn_id,
          }) },
      }).catch(() => {});

      throw new DomainError('EXTERNAL_PROVIDER_ERROR', `Refund gateway error: ${errorMsg}`, { provider: body.provider_code }, 502);
    }
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid refund payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
