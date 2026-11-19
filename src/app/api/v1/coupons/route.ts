// GET  /api/v1/coupons  — list coupons (sale.read)
// POST /api/v1/coupons  — create a coupon (coupon.manage)
// Coupons apply at the till through the sale's coupon_code; see
// src/domain/loyalty/coupons.ts for how the discount is worked out.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { requireFeatureFlag } from '@/lib/featureFlags';
import { getCorrelationId } from '@/lib/http';

const Money = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, 'An amount like 500 or 500.50');
const CouponSchema = z.object({
  code: z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, - and _ only').transform(v => v.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  discount_type: z.enum(['fixed', 'percentage']),
  value: Money,
  max_discount_amount: Money.optional(),
  min_order_amount: Money.default('0'),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  usage_limit: z.number().int().min(1).max(1_000_000).optional(),
}).refine(c => c.discount_type === 'fixed' || Number(c.value) <= 100, { message: 'A percentage is at most 100', path: ['value'] })
  .refine(c => Number(c.value) > 0, { message: 'The value must be more than zero', path: ['value'] })
  .refine(c => !c.valid_to || c.valid_to >= c.valid_from, { message: 'The end date is before the start date', path: ['valid_to'] });

const view = (c: Awaited<ReturnType<typeof db.coupon.findFirstOrThrow>>) => ({
  id: c.id, code: c.code, name: c.name, discount_type: c.discountType, value: c.value.toString(),
  max_discount_amount: c.maxDiscountAmount?.toString() ?? null, min_order_amount: c.minOrderAmount.toString(),
  valid_from: c.validFrom, valid_to: c.validTo, usage_limit: c.usageLimit, usage_count: c.usageCount, is_active: c.isActive,
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'sale.read');
    const items = await runInTenantContext(auth.ctx, async () => {
      await requireFeatureFlag('loyalty_enabled');
      return db.coupon.findMany({ where: { companyId: auth.companyId }, orderBy: { createdAt: 'desc' }, take: 200 });
    });
    return NextResponse.json({ items: items.map(view) });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'coupon.manage');
    await runInTenantContext(auth.ctx, async () => { await requireFeatureFlag('loyalty_enabled'); });
    const idempotencyKey = requireIdempotencyKey(req);
    const body = CouponSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/coupons', body });
    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async tx =>
        withIdempotency(
          { idempotencyKey, operation: 'coupon.create', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            if (await tx.coupon.findFirst({ where: { companyId: auth.companyId, code: body.code }, select: { id: true } })) {
              throw new DomainError('VALIDATION_FAILED', `Coupon code ${body.code} is already used`, {}, 409);
            }
            const coupon = await tx.coupon.create({ data: {
              companyId: auth.companyId, code: body.code, name: body.name, discountType: body.discount_type, value: body.value,
              maxDiscountAmount: body.discount_type === 'percentage' ? body.max_discount_amount ?? null : null,
              minOrderAmount: body.min_order_amount, validFrom: new Date(`${body.valid_from}T00:00:00Z`),
              validTo: body.valid_to ? new Date(`${body.valid_to}T23:59:59.999Z`) : null, usageLimit: body.usage_limit ?? null,
            } });
            await tx.auditLog.create({ data: { companyId: auth.companyId, userId: auth.userId, correlationId,
              action: 'coupon.create', entityType: 'coupon', entityId: coupon.id, afterValue: JSON.stringify(view(coupon)) } });
            return { status: 201, body: view(coupon), resourceType: 'coupon', resourceId: coupon.id };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', e.issues[0]?.message ?? 'Invalid coupon', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
