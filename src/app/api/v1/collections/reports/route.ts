// GET /api/v1/collections/reports?from=YYYY-MM-DD&to=YYYY-MM-DD — aging, due vs collected per day, collections by
//     salesperson, SMS per day, and collections within 3 days after a reminder (a correlation, labelled as such).

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { collectionReport } from '@/domain/receivables/collectionReports';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.view.branch');
    const p = req.nextUrl.searchParams;
    const report = await runInTenantContext(auth.ctx, () => collectionReport(db as unknown as Prisma.TransactionClient, auth.companyId,
      { from: p.get('from') ?? '', to: p.get('to') ?? '' }));
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e, correlationId); }
}
