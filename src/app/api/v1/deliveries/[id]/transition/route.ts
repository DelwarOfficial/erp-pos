// POST /api/v1/deliveries/{id}/transition

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { transitionDeliveryStatus } from '@/domain/commands/m5/Delivery';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const TransitionSchema = z.object({
  to_status: z.enum(['pending', 'packing', 'ready', 'dispatched', 'in_transit', 'delivered', 'failed', 'returned', 'cancelled']),
  note: z.string().max(2000).optional(),
  provider_status: z.string().max(100).optional(),
  location_text: z.string().max(255).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'delivery.dispatch');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = TransitionSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/deliveries/${id}/transition`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'delivery.transition', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const result = await transitionDeliveryStatus(tx, {
              deliveryOrderId: id, companyId: auth.companyId,
              toStatus: body.to_status, userId: auth.userId,
              note: body.note, providerStatus: body.provider_status,
              locationText: body.location_text,
            }, correlationId);
            return { status: 200, body: result, resourceType: 'delivery_order', resourceId: id };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid transition payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
