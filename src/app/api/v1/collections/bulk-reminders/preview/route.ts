// POST /api/v1/collections/bulk-reminders/preview — who a bulk reminder would reach and why the others would not:
//      counts (eligible, missing/invalid phone, already paid, opted out, duplicates), SMS parts, the daily limit left,
//      a sample text and the confirmation token that POST /bulk-reminders requires. Stores and sends nothing.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { BULK_MAX, previewBulkReminders } from '@/domain/receivables/reminders';

const Body = z.object({ installment_ids: z.array(z.string().uuid()).min(1).max(BULK_MAX), locale: z.enum(['bn', 'en']).optional() });

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.bulk_send.company');
    requireIdempotencyKey(req); // required on every POST; a preview stores nothing, so it is not recorded
    const body = Body.parse(await req.json());
    const preview = await runInTenantContext(auth.ctx, () =>
      previewBulkReminders(db as unknown as Prisma.TransactionClient, auth.companyId, body.installment_ids, new Date(), body.locale));
    return NextResponse.json(preview, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', `Select 1-${BULK_MAX} installments`, { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
