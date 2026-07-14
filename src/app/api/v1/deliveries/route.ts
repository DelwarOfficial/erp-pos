// GET  /api/v1/deliveries  — list delivery orders
// POST /api/v1/deliveries  — create delivery order from a posted sale

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { requireFeatureFlag } from '@/lib/featureFlags';
import { createDeliveryOrder, transitionDeliveryStatus } from '@/domain/commands/m5/Delivery';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const CreateDeliverySchema = z.object({
  sale_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  recipient_name: z.string().min(1).max(200),
  recipient_phone: z.string().min(1).max(30),
  address_snapshot: z.string().min(1),
  district: z.string().max(100).optional(),
  area: z.string().max(100).optional(),
  delivery_method: z.enum(['internal', 'courier', 'pickup']).default('internal'),
  courier_code: z.string().max(50).optional(),
  cod_amount: z.number().min(0).default(0),
  delivery_fee: z.number().min(0).default(0),
  items: z.array(z.object({
    sale_item_id: z.string().uuid(),
    quantity: z.number().positive(),
  })).min(1),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'delivery.create');
  await requirePermission(auth, 'inventory.read');
    const status = req.nextUrl.searchParams.get('status') ?? undefined;
    // Default to last 30 days to bound the result set on large tenant datasets.
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fromParam = req.nextUrl.searchParams.get('from');
    const toParam = req.nextUrl.searchParams.get('to');
    const applyDateFilter = req.nextUrl.searchParams.get('all_dates') !== 'true';
    const from = fromParam ? new Date(fromParam) : (applyDateFilter ? thirtyDaysAgo : undefined);
    const to = toParam ? new Date(toParam) : undefined;
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10), 200);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.status = status;
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Record<string, unknown>).gte = from;
      if (to) (where.createdAt as Record<string, unknown>).lte = to;
    }

    const deliveries = await db.deliveryOrder.findMany({
      where, take: limit, orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        referenceNo: true,
        status: true,
        deliveryMethod: true,
        courierCode: true,
        recipientName: true,
        recipientPhone: true,
        codAmount: true,
        deliveryFee: true,
        createdAt: true,
        deliveredAt: true,
        sale: { select: { id: true, referenceNo: true, grandTotal: true } },
        _count: { select: { items: true, events: true } },
      },
    });
    return NextResponse.json({
      items: deliveries.map(d => ({
        id: d.id, reference_no: d.referenceNo, status: d.status,
        sale: d.sale, delivery_method: d.deliveryMethod, courier_code: d.courierCode,
        recipient_name: d.recipientName, recipient_phone: d.recipientPhone,
        cod_amount: d.codAmount.toString(), delivery_fee: d.deliveryFee.toString(),
        item_count: d._count.items, event_count: d._count.events,
        created_at: d.createdAt, delivered_at: d.deliveredAt,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requireFeatureFlag('delivery_courier_enabled');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = CreateDeliverySchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/deliveries', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'delivery.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const result = await createDeliveryOrder(tx, {
              companyId: auth.companyId, branchId: body.branch_id, saleId: body.sale_id,
              createdBy: auth.userId,
              recipientName: body.recipient_name, recipientPhone: body.recipient_phone,
              addressSnapshot: body.address_snapshot,
              district: body.district, area: body.area,
              deliveryMethod: body.delivery_method, courierCode: body.courier_code,
              codAmount: body.cod_amount, deliveryFee: body.delivery_fee,
              items: body.items.map(i => ({ saleItemId: i.sale_item_id, quantity: i.quantity })),
            }, correlationId);
            return { status: 201, body: result, resourceType: 'delivery_order', resourceId: result.deliveryOrderId };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid delivery payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
