// POST /api/v1/payments/initiate — initiate a gateway payment via the payment provider
//
// §22 REDTEAM refactor: external gateway call moved OUT of the DB transaction.
// Pattern (post-commit outbox):
//   1. BEGIN tx → create 'pending' payment row + audit log + outbox event → COMMIT
//   2. Call provider.initiatePayment() OUTSIDE the transaction
//   3. On success: update payment row with gateway_txn_id + method_reference
//   4. On failure: update payment row status='failed' with error message
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

const InitiateSchema = z.object({
  provider_code: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3).default('BDT'),
  reference: z.string().min(1).max(120),
  return_url: z.string().url(),
  customer_id: z.string().uuid().optional(),
  sale_id: z.string().uuid().optional(),
  branch_id: z.string().uuid(),
  financial_account_id: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'sale.post');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = InitiateSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/payments/initiate', body });

    // ── Phase 1: Create pending payment row INSIDE a transaction ──
    // No external calls here — just DB writes that commit atomically.
    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'payment.initiate', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // Validate provider exists (cheap registry lookup, no network call)
            registerProviders();
            const provider = providerRegistry.getPayment(body.provider_code);
            if (!provider) {
              throw new DomainError('VALIDATION_FAILED', `Payment provider '${body.provider_code}' not registered`, {}, 400);
            }

            // Pre-create a 'pending' payment row so the webhook can update it
            const pending = await tx.payment.create({
              data: {
                companyId: auth.companyId, branchId: body.branch_id,
                referenceNo: body.reference, clientTxnId: randomUUID(),
                paymentType: 'sale_receipt', direction: 'incoming',
                customerId: body.customer_id ?? null,
                financialAccountId: body.financial_account_id ?? '00000000-0000-0000-0000-000000000000',
                currencyCode: body.currency, exchangeRate: 1,
                amount: body.amount, baseAmount: body.amount,
                paymentMethod: body.provider_code,
                methodReference: null, // will be set after gateway responds
                chequeStatus: 'not_applicable', paymentStatus: 'pending',
                businessDate: new Date(), receivedOrPaidAt: new Date(),
                createdBy: auth.userId, notes: `Gateway: ${body.provider_code}; sale_id=${body.sale_id ?? ''}`,
              },
            });

            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'payment.initiate.requested', entityType: 'payment', entityId: pending.id,
                afterValue: JSON.stringify({
                  provider: body.provider_code,
                  amount: body.amount, reference: body.reference,
                  status: 'pending_gateway',
                }) },
            });

            return {
              status: 201,
              body: { payment_id: pending.id, status: 'pending_gateway' },
              resourceType: 'payment', resourceId: pending.id,
            };
          });
        },
      ),
    );

    // Fetch the pending payment row (created in phase 1) by reference + branch.
    // The idempotency wrapper already prevents replays, so this is safe.
    const pendingPayment = await db.payment.findFirst({
      where: {
        companyId: auth.companyId,
        referenceNo: body.reference,
        paymentStatus: 'pending',
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    if (!pendingPayment) {
      throw new DomainError('INTERNAL_ERROR', 'Pending payment row not found after phase 1', {}, 500);
    }
    const paymentId = pendingPayment.id;

    // ── Phase 2: Call gateway OUTSIDE the transaction ──
    // Network call does not hold any DB locks. If it fails, we update the
    // payment row to 'failed' with the error. If it succeeds, we update
    // with the gateway_txn_id and return the gateway URL to the client.
    registerProviders();
    const provider = providerRegistry.getPayment(body.provider_code);
    if (!provider) {
      // Provider was unregistered between phase 1 and 2 — mark payment as failed
      await db.payment.update({
        where: { id: paymentId },
        data: { paymentStatus: 'failed', notes: `Provider '${body.provider_code}' not registered` },
      }).catch(() => {});
      throw new DomainError('VALIDATION_FAILED', `Payment provider '${body.provider_code}' not registered`, {}, 400);
    }

    try {
      const gateway = await provider.initiatePayment({
        amount: body.amount,
        currency: body.currency,
        reference: body.reference,
        returnUrl: body.return_url,
      });

      // Update payment row with gateway details (separate short transaction)
      await db.payment.update({
        where: { id: paymentId },
        data: {
          methodReference: gateway.gatewayTxnId,
          notes: `Gateway: ${body.provider_code}; gateway_txn_id=${gateway.gatewayTxnId}`,
        },
      });

      await db.auditLog.create({
        data: { companyId: auth.companyId, userId: auth.userId, correlationId,
          action: 'payment.initiate.success', entityType: 'payment', entityId: paymentId,
          afterValue: JSON.stringify({
            provider: body.provider_code, gateway_txn_id: gateway.gatewayTxnId,
            gateway_url: gateway.gatewayUrl,
          }) },
      });

      return NextResponse.json({
        payment_id: paymentId,
        status: 'initiated',
        gateway_url: gateway.gatewayUrl,
        gateway_txn_id: gateway.gatewayTxnId,
        provider: body.provider_code,
        amount: body.amount,
        currency: body.currency,
      }, { status: 201 });
    } catch (gatewayError) {
      // Gateway call failed — mark payment as failed and record audit
      const errorMsg = gatewayError instanceof Error ? gatewayError.message : 'Unknown gateway error';
      await db.payment.update({
        where: { id: paymentId },
        data: { paymentStatus: 'failed', notes: `Gateway error: ${errorMsg}` },
      }).catch(() => {});

      await db.auditLog.create({
        data: { companyId: auth.companyId, userId: auth.userId, correlationId,
          action: 'payment.initiate.failed', entityType: 'payment', entityId: paymentId,
          afterValue: JSON.stringify({ provider: body.provider_code, error: errorMsg }) },
      }).catch(() => {});

      throw new DomainError('EXTERNAL_PROVIDER_ERROR', `Payment gateway error: ${errorMsg}`, { provider: body.provider_code }, 502);
    }
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid initiate payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
