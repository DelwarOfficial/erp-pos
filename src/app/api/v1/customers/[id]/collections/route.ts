// POST /api/v1/customers/{id}/collections — the customer pays towards what they owe.
// Applied oldest due first (or to the chosen sales); see
// src/domain/receivables/CollectCustomerPayment.ts.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { collectCustomerPayment } from '@/domain/receivables/CollectCustomerPayment';
import { assertBranchAccess } from '@/lib/db/branchScope';

const CollectSchema = z.object({
  branch_id: z.string().uuid(),
  financial_account_id: z.string().uuid(),
  // A decimal string: money never passes through floating point.
  amount: z.string().regex(/^\d{1,15}(\.\d{1,2})?$/, 'An amount with at most two decimal places, as a string'),
  payment_method: z.enum(['cash', 'card', 'cheque', 'bkash', 'nagad', 'rocket', 'bank_transfer', 'other']),
  method_reference: z.string().max(120).optional(),
  cashier_shift_id: z.string().uuid().optional(),
  sale_ids: z.array(z.string().uuid()).min(1).max(100).optional(),
  notes: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'payment.pay.branch');
    const idempotencyKey = requireIdempotencyKey(req);
    const { id: customerId } = await params;
    const body = CollectSchema.parse(await req.json());
    assertBranchAccess(body.branch_id, auth.ctx);
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/customers/${customerId}/collections`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async tx =>
        withIdempotency(
          { idempotencyKey, operation: 'customer.collection', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const collected = await collectCustomerPayment(tx, {
              companyId: auth.companyId, branchId: body.branch_id, customerId, amount: body.amount,
              financialAccountId: body.financial_account_id, paymentMethod: body.payment_method,
              methodReference: body.method_reference, cashierShiftId: body.cashier_shift_id,
              businessDate: new Date(), collectedBy: auth.userId, saleIds: body.sale_ids, notes: body.notes,
            }, correlationId);
            return {
              status: 201,
              body: {
                payment_id: collected.paymentId, reference_no: collected.referenceNo, amount: collected.amount,
                customer_outstanding: collected.customerOutstanding,
                applied: collected.applied.map(a => ({
                  sale_id: a.saleId, sale_reference_no: a.saleReferenceNo, installment_id: a.installmentId,
                  installment_no: a.installmentNo, amount: a.amount, remaining: a.remaining,
                })),
              },
              resourceType: 'payment', resourceId: collected.paymentId,
            };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid collection', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
