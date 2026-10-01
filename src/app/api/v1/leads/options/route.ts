import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { readListPage, listPageArgs, listPageResult } from '@/lib/api/listPage';

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(); await requirePermission(auth, 'crm.lead.read');
    const page = readListPage(req.nextUrl); const kind = req.nextUrl.searchParams.get('kind') ?? 'status';
    const where = { companyId: auth.companyId, isActive: true, name: { contains: req.nextUrl.searchParams.get('search') ?? '' } };
    const rows = await runInTenantContext(auth.ctx, async () => {
      const args = { where, ...listPageArgs(page), orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }] };
      if (kind === 'status') return db.leadStatus.findMany({ ...args, select: { id: true, name: true, isWon: true, isLost: true } });
      if (kind === 'source') return db.leadSource.findMany({ ...args, select: { id: true, name: true } });
      if (kind === 'subject') return db.leadSubject.findMany({ ...args, select: { id: true, name: true } });
      if (kind === 'assignee') return db.user.findMany({ ...args, where: { ...where, deletedAt: null }, select: { id: true, name: true } });
      throw new DomainError('VALIDATION_FAILED', 'Unknown lead option type', {}, 400);
    });
    return NextResponse.json(listPageResult(rows, page));
  } catch (error) { return errorResponse(error, getCorrelationId(req)); }
}
