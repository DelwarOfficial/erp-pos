// PATCH /api/v1/coupons/{id}  { is_active }  — switch a coupon off or back on (coupon.manage).
// Coupons are not edited or deleted once made: their redemptions refer to them.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { requireFeatureFlag } from '@/lib/featureFlags';
import { getCorrelationId } from '@/lib/http';

const ToggleSchema = z.object({ is_active: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'coupon.manage');
    await runInTenantContext(auth.ctx, async () => { await requireFeatureFlag('loyalty_enabled'); });
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = ToggleSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'PATCH', path: `/api/v1/coupons/${id}`, body });
    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async tx =>
        withIdempotency(
          { idempotencyKey, operation: 'coupon.toggle', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const coupon = await tx.coupon.findFirst({ where: { id, companyId: auth.companyId } });
            if (!coupon) throw new DomainError('RESOURCE_NOT_FOUND', 'Coupon not found', {}, 404);
            await tx.coupon.update({ where: { id }, data: { isActive: body.is_active } });
            await tx.auditLog.create({ data: { companyId: auth.companyId, userId: auth.userId, correlationId,
              action: body.is_active ? 'coupon.activate' : 'coupon.deactivate', entityType: 'coupon', entityId: id,
              beforeValue: JSON.stringify({ is_active: coupon.isActive }), afterValue: JSON.stringify({ is_active: body.is_active }) } });
            return { status: 200, body: { id, is_active: body.is_active }, resourceType: 'coupon', resourceId: id };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid coupon change', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
