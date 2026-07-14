// POST /api/v1/transfers/{id}/receive

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { receiveTransfer } from '@/domain/commands/m2/Transfer';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'transfer.receive');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/transfers/${id}/receive`, body: {} });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'transfer.receive', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const result = await receiveTransfer(tx, { transferId: id, companyId: auth.companyId, receivedBy: auth.userId }, correlationId);
            return { status: 200, body: result, resourceType: 'transfer', resourceId: id };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) { return errorResponse(e, correlationId); }
}
