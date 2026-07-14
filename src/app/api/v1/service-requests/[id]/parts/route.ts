// POST /api/v1/service-requests/{id}/parts — consume parts for a service request

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postServicePartConsumption } from '@/domain/commands/m5/Service';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const ConsumePartsSchema = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().positive(),
    unit_price: z.number().min(0),
    warranty_covered: z.boolean().default(false),
  })).min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'service.complete');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = ConsumePartsSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/service-requests/${id}/parts`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'service_part.consume', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const result = await postServicePartConsumption(tx, {
              serviceRequestId: id, companyId: auth.companyId,
              consumedBy: auth.userId,
              items: body.items.map(i => ({
                productId: i.product_id, quantity: i.quantity,
                unitPrice: i.unit_price, warrantyCovered: i.warranty_covered,
              })),
            }, correlationId);
            return { status: 200, body: result, resourceType: 'service_request', resourceId: id };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid parts payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
