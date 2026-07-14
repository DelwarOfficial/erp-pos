// POST /api/v1/landed-costs

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postLandedCost } from '@/domain/commands/m2/PostLandedCost';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const LandedCostSchema = z.object({
  purchase_id: z.string().uuid(),
  cost_type: z.enum(['freight', 'insurance', 'customs', 'port', 'clearing', 'other']),
  supplier_id: z.string().uuid().optional(),
  currency_code: z.string().length(3).default('BDT'),
  exchange_rate: z.number().positive().default(1),
  amount: z.number().positive(),
  allocation_method: z.enum(['quantity', 'value', 'weight', 'manual']),
  manual_allocations: z.array(z.object({
    purchase_item_id: z.string().uuid(),
    allocated_base_amount: z.number().min(0),
  })).optional(),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'landed_cost.post');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = LandedCostSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/landed-costs', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'landed_cost.post', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const result = await postLandedCost(tx, {
              companyId: auth.companyId,
              purchaseId: body.purchase_id,
              costType: body.cost_type,
              supplierId: body.supplier_id,
              currencyCode: body.currency_code,
              exchangeRate: body.exchange_rate,
              amount: body.amount,
              allocationMethod: body.allocation_method,
              postedBy: auth.userId,
              manualAllocations: body.manual_allocations?.map(a => ({
                purchaseItemId: a.purchase_item_id,
                allocatedBaseAmount: a.allocated_base_amount,
              })),
            }, correlationId);
            return { status: 201, body: result, resourceType: 'landed_cost_document', resourceId: result.landedCostDocumentId };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid landed cost payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
