// POST /api/v1/accounting/period-close/{id}/unlock — unlock a soft-locked / locked period

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { unlockPeriod } from '@/lib/accounting/periodClose';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { requireMfaForAction } from '@/lib/auth/requireMfa';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'fiscal_period.unlock');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = {};
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/accounting/period-close/${id}/unlock`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'period_close.unlock', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // Unlocking a fully locked period requires platform operations scope.
            // auth.isGlobal is true for platform_operations users.
            await unlockPeriod(auth.companyId, id, auth.userId, auth.isGlobal);
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'period_close.unlock', entityType: 'fiscal_period', entityId: id,
                afterValue: JSON.stringify({ status: 'open', unlocked_by: auth.userId, platform_ops: auth.isGlobal }) },
            });
            return {
              status: 200,
              body: { fiscal_period_id: id, status: 'open', unlocked_by: auth.userId },
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
