// GET /api/v1/inventory/movements
// List stock movements (immutable ledger). Cursor pagination.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'inventory.read');
    const url = req.nextUrl;
    const warehouseId = url.searchParams.get('warehouse_id') ?? undefined;
    const productId = url.searchParams.get('product_id') ?? undefined;
    const movementType = url.searchParams.get('movement_type') ?? undefined;
    const from = url.searchParams.get('from') ? new Date(url.searchParams.get('from')!) : undefined;
    const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : undefined;
    const cursor = url.searchParams.get('cursor') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (warehouseId) where.warehouseId = warehouseId;
    if (productId) where.productId = productId;
    if (movementType) where.movementType = movementType;
    if (from || to) {
      where.effectiveAt = {};
      if (from) (where.effectiveAt as Record<string, unknown>).gte = from;
      if (to) (where.effectiveAt as Record<string, unknown>).lte = to;
    }
    if (cursor) where.id = { lt: cursor };

    const movements = await db.stockMovement.findMany({
      where,
      take: limit + 1,
      orderBy: { effectiveAt: 'desc' },
      include: {
        product: { select: { id: true, name: true, code: true } },
        warehouse: { select: { id: true, name: true, code: true } },
      },
    });

    const hasMore = movements.length > limit;
    const items = hasMore ? movements.slice(0, limit) : movements;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return NextResponse.json({
      items: items.map(m => ({
        id: m.id,
        event_id: m.eventId,
        event_line_no: m.eventLineNo,
        warehouse: m.warehouse,
        product: m.product,
        stock_bucket: m.stockBucket,
        movement_type: m.movementType,
        qty_delta: m.qtyDelta.toString(),
        unit_cost: m.unitCost.toString(),
        total_cost_delta: m.totalCostDelta.toString(),
        reference_type: m.referenceType,
        reference_id: m.referenceId,
        effective_at: m.effectiveAt,
        posted_at: m.postedAt,
        reversal_of_movement_id: m.reversalOfMovementId,
        metadata: m.metadata ? JSON.parse(m.metadata) : {},
      })),
      next_cursor: nextCursor,
      has_more: hasMore,
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
