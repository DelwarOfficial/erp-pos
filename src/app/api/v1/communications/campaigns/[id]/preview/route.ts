// POST /api/v1/communications/campaigns/{id}/preview — who the campaign would reach (latest marketing consent granted,
//      valid mobile, one per number) and why the others would not; SMS parts, today's limit left, a sample, and the
//      confirmation token the send requires. Stores and sends nothing.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { requireIdempotencyKey } from '@/lib/idempotency';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { previewCampaign } from '@/domain/communication/campaigns';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.campaign.manage.company');
    requireIdempotencyKey(req); // required on every POST; a preview stores nothing, so it is not recorded
    const { id } = await params;
    const preview = await runInTenantContext(auth.ctx, () => previewCampaign(db as unknown as Prisma.TransactionClient, auth.companyId, id));
    return NextResponse.json(preview, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e, correlationId); }
}
