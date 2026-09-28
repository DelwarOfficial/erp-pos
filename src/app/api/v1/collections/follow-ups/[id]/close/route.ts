// POST /api/v1/collections/follow-ups/{id}/close — mark an open follow-up done or cancelled, with an outcome note. Audited.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { closeFollowUp } from '@/domain/receivables/followUps';

const Body = z.object({ outcome: z.enum(['done', 'cancelled']), note: z.string().max(2000).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.manage.branch');
    const idempotencyKey = requireIdempotencyKey(req);
    const { id } = await params;
    const body = Body.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/collections/follow-ups/${id}/close`, body });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'collection.follow_up.close', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
        await closeFollowUp(tx, auth.companyId, id, body.outcome, body.note, auth.userId);
        return { status: 200, body: { id, status: body.outcome }, resourceType: 'collection_follow_up', resourceId: id };
      },
      tx,
    )));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid request', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
