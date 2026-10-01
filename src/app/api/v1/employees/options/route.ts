import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { readListPage, listPageArgs, listPageResult } from '@/lib/api/listPage';

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(); await requirePermission(auth, 'employee.read');
    const page = readListPage(req.nextUrl); const kind = req.nextUrl.searchParams.get('kind');
    const where = { companyId: auth.companyId, isActive: true, name: { contains: req.nextUrl.searchParams.get('search') ?? '' } };
    const rows = await runInTenantContext(auth.ctx, async () => {
      const args = { where, ...listPageArgs(page), orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }], select: { id: true, name: true } };
      if (kind === 'department') return db.department.findMany(args);
      if (kind === 'designation') return db.designation.findMany(args);
      if (kind === 'user') return db.user.findMany({ ...args, where: { ...where, deletedAt: null } });
      throw new DomainError('VALIDATION_FAILED', 'Unknown employee option type', {}, 400);
    });
    return NextResponse.json(listPageResult(rows, page));
  } catch (error) { return errorResponse(error, getCorrelationId(req)); }
}
