// GET /api/v1/warehouses
// List active warehouses for the current tenant. Used by POS / stock dropdown selectors.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    try { await requirePermission(auth, 'inventory.read'); } catch { /* optional */ }

    const warehouses = await db.warehouse.findMany({
      where: { companyId: auth.companyId, isActive: true },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
      select: {
        id: true, name: true, code: true, warehouseType: true,
        branch: { select: { id: true, name: true, code: true } },
      },
    });

    return NextResponse.json({
      items: warehouses.map(w => ({
        id: w.id, name: w.name, code: w.code,
        warehouse_type: w.warehouseType,
        branch: w.branch,
      })),
      total: warehouses.length,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}
