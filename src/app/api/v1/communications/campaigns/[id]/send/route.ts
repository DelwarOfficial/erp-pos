// POST /api/v1/communications/campaigns/{id}/send — send a draft campaign to exactly the previewed audience
//      (confirmation_token); 409 if it changed or exceeds today's SMS limit. Messages go out within the sending
//      window as promotional SMS, each re-checked for consent first. Audited.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { sendCampaign } from '@/domain/communication/campaigns';

const Body = z.object({ confirmation_token: z.string().regex(/^[0-9a-f]{64}$/) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.campaign.send');
    const idempotencyKey = requireIdempotencyKey(req);
    const { id } = await params;
    const body = Body.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/communications/campaigns/${id}/send`, body });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'communication_campaign.send', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
        const sent = await sendCampaign(tx, auth.companyId, id, body.confirmation_token, auth.userId);
        return { status: 202, body: { id, status: 'running', queued: sent.queued, preview: sent.preview }, resourceType: 'communication_campaign', resourceId: id };
      },
      tx,
    ), { timeout: 120_000 }));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Preview first: the confirmation token is missing', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
