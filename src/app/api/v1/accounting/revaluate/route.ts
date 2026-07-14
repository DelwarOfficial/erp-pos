// POST /api/v1/accounting/revaluate — run a multi-currency revaluation (uses runRevaluation)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { runRevaluation } from '@/lib/accounting/revaluation';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { requireFeatureFlag } from '@/lib/featureFlags';

const RevaluateSchema = z.object({
  currency_code: z.string().length(3),
  period_end_date: z.string().datetime(),
  period_end_rate: z.number().positive(),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requireFeatureFlag('multi_currency_enabled');
    await requirePermission(auth, 'journal.post');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = RevaluateSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/accounting/revaluate', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'revaluation.run', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const out = await runRevaluation({
              companyId: auth.companyId,
              currencyCode: body.currency_code,
              periodEndDate: new Date(body.period_end_date),
              periodEndRate: body.period_end_rate,
              createdBy: auth.userId,
            });
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'revaluation.run', entityType: 'currency_revaluation', entityId: out.revaluationId,
                afterValue: JSON.stringify({
                  currency: body.currency_code, rate: body.period_end_rate,
                  gain: out.totalUnrealizedGain, loss: out.totalUnrealizedLoss,
                }) },
            });
            return {
              status: 201,
              body: out,
              resourceType: 'currency_revaluation', resourceId: out.revaluationId,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid revaluation payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
