// POST /api/v1/customers/{id}/points/confirmations
//   { points, items: [{ product_id, qty, unit_price, discount_amount? }], coupon_code? }
// Texts the customer a one-time code to consent to spending `points` on this
// cart (sale.post, loyalty on). Returns { confirmation_id, expires_at,
// phone_masked }. At most 3 codes per customer per 10 minutes.
// See src/domain/loyalty/confirmations.ts.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { requireFeatureFlag } from '@/lib/featureFlags';
import { getCorrelationId } from '@/lib/http';
import { checkDistributedRateLimit, unavailableError } from '@/lib/auth/distributedRateLimiter';
import { requestPointsConfirmation } from '@/domain/loyalty/confirmations';
import { transactionalSmsGateway } from '@/lib/sms/credentials';

const RequestSchema = z.object({
  points: z.number().int().positive().max(10_000_000),
  items: z.array(z.object({
    product_id: z.string().uuid(), qty: z.number().positive(), unit_price: z.number().nonnegative(),
    discount_amount: z.number().nonnegative().optional(),
  })).min(1).max(200),
  coupon_code: z.string().trim().max(30).optional(),
});
const CODE_LIMIT = { maxAttempts: 3, windowMs: 10 * 60 * 1000, lockMs: 10 * 60 * 1000, maxLockMs: 60 * 60 * 1000 };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'sale.post');
    await runInTenantContext(auth.ctx, () => requireFeatureFlag('loyalty_enabled'));
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = RequestSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/customers/${id}/points/confirmations`, body });
    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async tx =>
        withIdempotency(
          { idempotencyKey, operation: 'reward_points.confirmation_request', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            // Counted only for a new request: a retry of the same key is replayed above.
            const limit = await checkDistributedRateLimit('points-code', `${auth.companyId}:${id}`, CODE_LIMIT);
            if (limit.unavailable) throw unavailableError();
            if (!limit.allowed) throw new DomainError('RATE_LIMITED', 'Too many codes sent to this customer. Try again in a few minutes.', {}, 429);
            const confirmation = await requestPointsConfirmation(tx, {
              companyId: auth.companyId, requestedBy: auth.userId!, correlationId,
              gateway: await transactionalSmsGateway(tx, auth.companyId),
              intent: { customerId: id, points: body.points, couponCode: body.coupon_code,
                items: body.items.map(i => ({ productId: i.product_id, qty: i.qty, unitPrice: i.unit_price, discountAmount: i.discount_amount })) },
            });
            return { status: 201, body: { confirmation_id: confirmation.id, expires_at: confirmation.expiresAt, phone_masked: confirmation.phoneMasked },
              resourceType: 'reward_point_confirmation', resourceId: confirmation.id };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid points confirmation request', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
