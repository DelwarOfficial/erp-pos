import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { readListPage, listPageArgs, listPageResult } from '@/lib/api/listPage';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(); await requirePermission(auth, 'inventory.read');
    const page = readListPage(req.nextUrl); const search = req.nextUrl.searchParams.get('search') ?? '';
    const rows = await runInTenantContext(auth.ctx, async () => db.inventoryReasonCode.findMany({ where: { companyId: auth.companyId, isActive: true, ...(search ? { OR: [{ name: { contains: search } }, { code: { contains: search } }] } : {}) }, ...listPageArgs(page), orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, code: true, requiresApproval: true } }));
    return NextResponse.json(listPageResult(rows, page));
  } catch (error) { return errorResponse(error, getCorrelationId(req)); }
}
