// GET  /api/v1/communications/campaigns — marketing SMS campaigns with message counts, and the customer groups to target.
// POST /api/v1/communications/campaigns — create a draft: name, text ({{customer_name}}, {{company_name}}), language,
//      optional customer group. Nothing is sent until it is previewed and sent.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { CAMPAIGN_TEXT_MAX, createCampaign, listCampaigns } from '@/domain/communication/campaigns';

const Body = z.object({
  name: z.string().min(1).max(120),
  text: z.string().min(1).max(CAMPAIGN_TEXT_MAX),
  locale: z.enum(['bn', 'en']),
  customer_group_id: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.campaign.manage.company');
    const result = await runInTenantContext(auth.ctx, () => listCampaigns(db as unknown as Prisma.TransactionClient, auth.companyId));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.campaign.manage.company');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = Body.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/communications/campaigns', body });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'communication_campaign.create', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
        const campaign = await createCampaign(tx, auth.companyId, { name: body.name, text: body.text, locale: body.locale, customerGroupId: body.customer_group_id }, auth.userId);
        return { status: 201, body: { id: campaign.id, status: campaign.status }, resourceType: 'communication_campaign', resourceId: campaign.id };
      },
      tx,
    )));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid campaign', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
