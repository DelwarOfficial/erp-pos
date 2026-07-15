// GET /api/v1/branches
// List active branches for the current tenant. Used by dropdown selectors in POS / payments forms.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    // Any authenticated user with read access to a branch-scoped module may list branches.
    // Fall through silently if the user lacks 'inventory.read' — we still need a tenant-scoped list.
    try { await requirePermission(auth, 'inventory.read'); } catch { /* optional */ }

    const branches = await db.branch.findMany({
      where: { companyId: auth.companyId, isActive: true },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, code: true, address: true, phone: true },
    });

    return NextResponse.json({
      items: branches.map(b => ({
        id: b.id, name: b.name, code: b.code,
        address: b.address, phone: b.phone,
      })),
      total: branches.length,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}
