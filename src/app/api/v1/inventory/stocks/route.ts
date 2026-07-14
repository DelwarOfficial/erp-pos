// GET /api/v1/inventory/stocks
// List warehouse stock projections. Filter by warehouse, product, low-stock.

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
    const lowStockOnly = url.searchParams.get('low_stock') === 'true';
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10), 500);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (warehouseId) where.warehouseId = warehouseId;
    if (productId) where.productId = productId;

    const stocks = await db.warehouseStock.findMany({
      where,
      take: limit,
      include: {
        product: {
          select: {
            id: true, name: true, code: true,
            isSerialized: true, alertQuantity: true,
            unit: { select: { code: true, name: true } },
          },
        },
        warehouse: { select: { id: true, name: true, code: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    let items = stocks.map(s => {
      const qtyOnHand = parseFloat(s.qtyOnHand.toString());
      const qtyReserved = parseFloat(s.qtyReserved.toString());
      const qtyAvailable = qtyOnHand - qtyReserved;
      const alertQty = parseFloat(s.product.alertQuantity.toString());
      return {
        id: s.id,
        warehouse: s.warehouse,
        product: s.product,
        qty_on_hand: s.qtyOnHand.toString(),
        qty_reserved: s.qtyReserved.toString(),
        qty_available: qtyAvailable.toString(),
        qty_in_transit_out: s.qtyInTransitOut.toString(),
        qty_damaged: s.qtyDamaged.toString(),
        moving_average_cost: s.movingAverageCost.toString(),
        inventory_value: (qtyOnHand * parseFloat(s.movingAverageCost.toString())).toFixed(2),
        is_low_stock: qtyAvailable <= alertQty,
        version: s.version,
        updated_at: s.updatedAt,
      };
    });

    if (lowStockOnly) {
      items = items.filter(i => i.is_low_stock);
    }

    return NextResponse.json({ items, count: items.length });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
