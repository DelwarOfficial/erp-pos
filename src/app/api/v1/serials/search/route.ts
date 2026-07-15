// GET /api/v1/serials/search — search product serials by serial_number/IMEI

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'inventory.read');
    const url = req.nextUrl;
    const q = url.searchParams.get('q') ?? '';
    const warehouseId = url.searchParams.get('warehouse_id') ?? undefined;
    const status = url.searchParams.get('status') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

    if (!q || q.length < 2) {
      throw new DomainError('VALIDATION_FAILED', 'Query parameter q (min 2 chars) is required', {}, 400);
    }

    const where: Record<string, unknown> = {
      companyId: auth.companyId,
      serialNumber: { contains: q },
    };
    if (warehouseId) where.currentWarehouseId = warehouseId;
    if (status) where.status = status;

    const serials = await db.productSerial.findMany({
      where, take: limit, orderBy: { updatedAt: 'desc' },
      include: {
        product: { select: { id: true, code: true, name: true, productType: true } },
        currentWarehouse: { select: { id: true, code: true, name: true } },
      },
    });

    return NextResponse.json({
      items: serials.map(s => ({
        id: s.id,
        serial_number: s.serialNumber,
        status: s.status,
        product: s.product,
        current_warehouse: s.currentWarehouse,
        warranty_start_date: s.warrantyStartDate,
        warranty_expiry_date: s.warrantyExpiryDate,
        version: s.version,
        updated_at: s.updatedAt,
      })),
      total: serials.length, limit, query: q,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}
