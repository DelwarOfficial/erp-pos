// GET /api/v1/reports/trial-balance
// Trial balance from the ledger, aggregated in the database.
// See src/lib/accounting/trialBalance.ts for what this used to get wrong.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { computeTrialBalance, parseAsOf } from '@/lib/accounting/trialBalance';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'report.execute');
    const asOf = parseAsOf(req.nextUrl.searchParams.get('as_of'));

    const report = await runInTenantContext(auth.ctx, () => computeTrialBalance(db, auth.companyId, asOf));
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e, correlationId); }
}
