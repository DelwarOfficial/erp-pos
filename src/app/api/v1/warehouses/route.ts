// GET /api/v1/warehouses
// List active warehouses for the current tenant. Used by POS / stock dropdown selectors.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { readListPage, listPageArgs, listPageResult } from '@/lib/api/listPage';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const page = readListPage(req.nextUrl);
    try { await requirePermission(auth, 'inventory.read'); } catch { /* optional */ }

    const warehousesPage = await runInTenantContext(auth.ctx, async () => {
      return db.warehouse.findMany({
        ...listPageArgs(page),
        where: { companyId: auth.companyId, isActive: true },
        orderBy: [{ code: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: {
          id: true, name: true, code: true, warehouseType: true,
          branch: { select: { id: true, name: true, code: true } },
        },
      });
    });
    const { items: warehouses, has_more, next_cursor } = listPageResult(warehousesPage, page);

    return NextResponse.json({
      has_more, next_cursor,
      items: warehouses.map(w => ({
        id: w.id, name: w.name, code: w.code,
        warehouse_type: w.warehouseType,
        branch: w.branch,
      })),
      total: warehouses.length,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}
