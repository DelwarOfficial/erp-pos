// GET /api/v1/collections/calendar?month=YYYY-MM — per day: installments still owed, promises, open follow-ups.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { collectionCalendar } from '@/domain/receivables/collectionReports';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.view.branch');
    const month = req.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
    const calendar = await runInTenantContext(auth.ctx, () => collectionCalendar(db as unknown as Prisma.TransactionClient, auth.companyId, month));
    return NextResponse.json(calendar, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e, correlationId); }
}
