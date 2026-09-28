// GET /api/v1/communications/templates — the due reminder texts (built-in and the company's own), with sample previews.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { listReminderTemplates } from '@/domain/receivables/templateSettings';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.template.manage.company');
    const templates = await runInTenantContext(auth.ctx, () => listReminderTemplates(db as unknown as Prisma.TransactionClient, auth.companyId));
    return NextResponse.json(templates);
  } catch (e) { return errorResponse(e, correlationId); }
}
