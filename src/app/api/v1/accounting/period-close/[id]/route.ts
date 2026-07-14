// POST /api/v1/accounting/period-close/{id} — run the period-end close workflow

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { runPeriodCloseWorkflow } from '@/lib/accounting/periodClose';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'fiscal_period.lock');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    // Empty body is fine — workflow doesn't take params beyond the period id
    const body = {};
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/accounting/period-close/${id}`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'period_close.run', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const out = await runPeriodCloseWorkflow(auth.companyId, id, auth.userId);
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'period_close.run', entityType: 'fiscal_period', entityId: id,
                afterValue: JSON.stringify({
                  can_lock: out.canLock, blockers: out.blockers,
                  steps: out.steps.map(s => ({ step: s.step, status: s.status })),
                }) },
            });
            return {
              status: 200,
              body: out,
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
