// GET /api/v1/collections/overview — collection KPIs for the control centre.
// See src/domain/receivables/collections.ts.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { collectionOverview } from '@/domain/receivables/collections';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.view.branch');
    const overview = await runInTenantContext(auth.ctx, () => collectionOverview(db as unknown as Prisma.TransactionClient, auth.companyId));
    return NextResponse.json(overview, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e, correlationId); }
}
