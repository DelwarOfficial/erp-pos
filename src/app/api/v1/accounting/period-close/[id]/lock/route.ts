// POST /api/v1/accounting/period-close/{id}/lock — lock a soft-locked period

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { lockPeriod } from '@/lib/accounting/periodClose';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { requireMfaForAction } from '@/lib/auth/requireMfa';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'fiscal_period.lock');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = {};
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/accounting/period-close/${id}/lock`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'period_close.lock', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            await lockPeriod(auth.companyId, id, auth.userId);
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'period_close.lock', entityType: 'fiscal_period', entityId: id,
                afterValue: JSON.stringify({ status: 'locked', locked_by: auth.userId }) },
            });
            return {
              status: 200,
              body: { fiscal_period_id: id, status: 'locked', locked_by: auth.userId },
              resourceType: 'fiscal_period', resourceId: id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
