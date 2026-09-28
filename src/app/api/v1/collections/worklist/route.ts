// GET /api/v1/collections/worklist?view=due_today|overdue|upcoming|all_open&days=&q=&biller_id=&branch_id=&cursor=&limit=
// One row per installment with money outstanding, oldest due first; keyset paged.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { collectionWorklist, WORKLIST_PAGE_MAX, type WorklistView } from '@/domain/receivables/collections';

const VIEWS: WorklistView[] = ['due_today', 'overdue', 'upcoming', 'all_open'];
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.view.branch');
    const p = req.nextUrl.searchParams;
    const view = (p.get('view') ?? 'due_today') as WorklistView;
    if (!VIEWS.includes(view)) throw new DomainError('VALIDATION_FAILED', `view must be one of ${VIEWS.join(', ')}`, {}, 400);
    const limit = p.get('limit') ? Number(p.get('limit')) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > WORKLIST_PAGE_MAX)) {
      throw new DomainError('VALIDATION_FAILED', `limit must be 1-${WORKLIST_PAGE_MAX}`, {}, 400);
    }
    const cursor = p.get('cursor') ?? undefined;
    if (cursor && !/^\d{4}-\d{2}-\d{2}\|[0-9a-f-]{36}$/i.test(cursor)) throw new DomainError('VALIDATION_FAILED', 'cursor is not valid', {}, 400);
    for (const key of ['biller_id', 'branch_id']) {
      const value = p.get(key);
      if (value && !UUID.test(value)) throw new DomainError('VALIDATION_FAILED', `${key} is not valid`, {}, 400);
    }
    const days = p.get('days') ? Number(p.get('days')) : undefined;
    const result = await runInTenantContext(auth.ctx, () => collectionWorklist(db as unknown as Prisma.TransactionClient, auth.companyId, {
      view, days: Number.isFinite(days) ? days : undefined, q: p.get('q')?.slice(0, 80) ?? undefined,
      billerId: p.get('biller_id') ?? undefined, branchId: p.get('branch_id') ?? undefined, cursor, limit,
    }));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e, correlationId); }
}
