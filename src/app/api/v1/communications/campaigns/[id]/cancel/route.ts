// POST /api/v1/communications/campaigns/{id}/cancel — stop a draft or running campaign; messages not yet sent are cancelled. Audited.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { cancelCampaign } from '@/domain/communication/campaigns';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.campaign.manage.company');
    const idempotencyKey = requireIdempotencyKey(req);
    const { id } = await params;
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/communications/campaigns/${id}/cancel`, body: {} });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'communication_campaign.cancel', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
        const cancelled = await cancelCampaign(tx, auth.companyId, id, auth.userId);
        return { status: 200, body: { id, status: 'cancelled', cancelled_messages: cancelled.cancelledMessages }, resourceType: 'communication_campaign', resourceId: id };
      },
      tx,
    )));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) { return errorResponse(e, correlationId); }
}
