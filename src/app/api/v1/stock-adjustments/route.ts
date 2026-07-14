// POST /api/v1/stock-adjustments

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postStockAdjustment } from '@/domain/commands/m2/PostStockAdjustment';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const AdjustmentSchema = z.object({
  branch_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  adjustment_type: z.enum(['add', 'subtract', 'damage', 'writeoff', 'reclassify', 'count_variance', 'correction']),
  reason_code_id: z.string().uuid(),
  business_date: z.string().datetime(),
  notes: z.string().min(1),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity_delta: z.number().refine(n => n !== 0, 'must be non-zero'),
    unit_cost: z.number().min(0).optional(),
  })).min(1),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'stock_adjustment.post');
  await requirePermission(auth, 'inventory.read');
    const adjustments = await db.stockAdjustment.findMany({
      where: { companyId: auth.companyId },
      take: 50, orderBy: { createdAt: 'desc' },
      include: {
        warehouse: { select: { name: true, code: true } },
        reasonCode: { select: { code: true, name: true } },
        _count: { select: { items: true } },
      },
    });
    return NextResponse.json({
      items: adjustments.map(a => ({
        id: a.id, reference_no: a.referenceNo, status: a.status,
        adjustment_type: a.adjustmentType, reason_code: a.reasonCode,
        warehouse: a.warehouse, item_count: a._count.items,
        business_date: a.businessDate, posted_at: a.postedAt,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    const body = AdjustmentSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/stock-adjustments', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'stock_adjustment.post', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const result = await postStockAdjustment(tx, {
              companyId: auth.companyId,
              branchId: body.branch_id,
              warehouseId: body.warehouse_id,
              adjustmentType: body.adjustment_type,
              reasonCodeId: body.reason_code_id,
              businessDate: new Date(body.business_date),
              notes: body.notes,
              postedBy: auth.userId,
              items: body.items.map(i => ({
                productId: i.product_id,
                quantityDelta: i.quantity_delta,
                unitCost: i.unit_cost,
              })),
            }, correlationId);
            return { status: 201, body: result, resourceType: 'stock_adjustment', resourceId: result.adjustmentId };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid adjustment payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
