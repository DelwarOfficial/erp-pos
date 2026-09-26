// GET /api/v1/branches
// List active branches for the current tenant. Used by dropdown selectors in POS / payments forms.

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
    // Any authenticated user with read access to a branch-scoped module may list branches.
    // Fall through silently if the user lacks 'inventory.read' — we still need a tenant-scoped list.
    try { await requirePermission(auth, 'inventory.read'); } catch { /* optional */ }

    // Tenant-scoped read must run inside explicit context (no ambient ALS).
    const branchesPage = await runInTenantContext(auth.ctx, async () => {
      return db.branch.findMany({
        ...listPageArgs(page),
        where: { companyId: auth.companyId, isActive: true },
        orderBy: [{ code: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, code: true, address: true, phone: true },
      });
    });
    const { items: branches, has_more, next_cursor } = listPageResult(branchesPage, page);

    return NextResponse.json({
      has_more, next_cursor,
      items: branches.map(b => ({
        id: b.id, name: b.name, code: b.code,
        address: b.address, phone: b.phone,
      })),
      total: branches.length,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}
