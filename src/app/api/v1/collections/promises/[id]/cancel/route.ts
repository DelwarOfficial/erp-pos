// POST /api/v1/collections/promises/{id}/cancel — withdraw an open promise, with a reason. Audited.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { cancelPromise } from '@/domain/receivables/followUps';

const Body = z.object({ reason: z.string().min(1).max(190) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.manage.branch');
    const idempotencyKey = requireIdempotencyKey(req);
    const { id } = await params;
    const body = Body.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/collections/promises/${id}/cancel`, body });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'collection.promise.cancel', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
        await cancelPromise(tx, auth.companyId, id, body.reason, auth.userId);
        return { status: 200, body: { id, status: 'cancelled' }, resourceType: 'collection_promise', resourceId: id };
      },
      tx,
    )));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Give a reason', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
