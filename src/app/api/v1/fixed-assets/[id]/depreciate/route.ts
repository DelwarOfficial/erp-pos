// POST /api/v1/fixed-assets/{id}/depreciate — run a single depreciation period

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postDepreciation } from '@/domain/commands/m4/AssetManagement';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const DepreciateSchema = z.object({
  period_start: z.string(),
  period_end: z.string(),
  currency_code: z.string().length(3).default('BDT'),
  exchange_rate: z.number().positive().default(1.0),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'asset.depreciate.company');
    const { id } = await params;

    const idempotencyKey = requireIdempotencyKey(req);
    const body = DepreciateSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/fixed-assets/${id}/depreciate`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'fixed_asset.depreciate', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const r = await postDepreciation(tx, {
              companyId: auth.companyId,
              fixedAssetId: id,
              periodStart: new Date(body.period_start),
              periodEnd: new Date(body.period_end),
              currencyCode: body.currency_code,
              exchangeRate: body.exchange_rate,
              createdBy: auth.userId!,
            }, correlationId);
            return {
              status: 201,
              body: {
                depreciation_id: r.depreciationId,
                depreciation_amount: r.depreciationAmount,
                accumulated_after: r.accumulatedAfter,
                net_book_value_after: r.netBookValueAfter,
                journal_entry_no: r.journalEntryNo,
              },
              resourceType: 'fixed_asset_depreciation',
              resourceId: r.depreciationId,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid depreciation payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
