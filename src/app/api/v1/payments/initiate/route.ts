// POST /api/v1/payments/initiate — initiate a gateway payment via the payment provider

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

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'payment.initiate', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            registerProviders();
            const provider = providerRegistry.getPayment(body.provider_code);
            if (!provider) {
              throw new DomainError('VALIDATION_FAILED', `Payment provider '${body.provider_code}' not registered`, {}, 400);
            }

            const gateway = await provider.initiatePayment({
              amount: body.amount,
              currency: body.currency,
              reference: body.reference,
              returnUrl: body.return_url,
            });

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
                paymentMethod: body.provider_code, methodReference: gateway.gatewayTxnId,
                chequeStatus: 'not_applicable', paymentStatus: 'pending',
                businessDate: new Date(), receivedOrPaidAt: new Date(),
                createdBy: auth.userId, notes: `Gateway: ${body.provider_code}; sale_id=${body.sale_id ?? ''}`,
              },
            });

            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'payment.initiate', entityType: 'payment', entityId: pending.id,
                afterValue: JSON.stringify({
                  provider: body.provider_code, gateway_txn_id: gateway.gatewayTxnId,
                  amount: body.amount, reference: body.reference,
                }) },
            });

            return {
              status: 201,
              body: {
                payment_id: pending.id,
                gateway_url: gateway.gatewayUrl,
                gateway_txn_id: gateway.gatewayTxnId,
                provider: body.provider_code,
                amount: body.amount,
                currency: body.currency,
              },
              resourceType: 'payment', resourceId: pending.id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid initiate payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
