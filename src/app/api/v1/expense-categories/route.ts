import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { readListPage, listPageArgs, listPageResult } from '@/lib/api/listPage';

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'expense.read');
    const page = readListPage(req.nextUrl);
    const search = req.nextUrl.searchParams.get('search')?.trim();
    const rows = await runInTenantContext(auth.ctx, async () => db.expenseCategory.findMany({
      ...listPageArgs(page), where: { companyId: auth.companyId, isActive: true, ...(search ? { name: { contains: search } } : {}) },
      orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true },
    }));
    return NextResponse.json(listPageResult(rows, page));
  } catch (error) { return errorResponse(error, getCorrelationId(req)); }
}
