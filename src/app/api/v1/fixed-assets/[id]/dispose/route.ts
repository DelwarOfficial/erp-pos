// POST /api/v1/fixed-assets/{id}/dispose — dispose of an asset (sold/scrapped/donated)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postAssetDisposal } from '@/domain/commands/m4/AssetManagement';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const DisposeSchema = z.object({
  disposed_at: z.string(),
  disposal_amount: z.number().min(0).default(0),
  disposal_method: z.enum(['sold', 'scrapped', 'donated']),
  financial_account_id: z.string().uuid().optional(),
  currency_code: z.string().length(3).default('BDT'),
  exchange_rate: z.number().positive().default(1.0),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'asset.manage.branch');
    const { id } = await params;

    const idempotencyKey = requireIdempotencyKey(req);
    const body = DisposeSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/fixed-assets/${id}/dispose`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'fixed_asset.dispose', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const r = await postAssetDisposal(tx, {
              companyId: auth.companyId,
              fixedAssetId: id,
              disposedAt: new Date(body.disposed_at),
              disposalAmount: body.disposal_amount,
              disposalMethod: body.disposal_method,
              financialAccountId: body.financial_account_id,
              currencyCode: body.currency_code,
              exchangeRate: body.exchange_rate,
              disposedBy: auth.userId!,
            }, correlationId);
            return {
              status: 200,
              body: {
                fixed_asset_id: r.fixedAssetId,
                status: r.status,
                disposal_amount: r.disposalAmount,
                gain_or_loss: r.gainOrLoss,
                journal_entry_no: r.journalEntryNo,
              },
              resourceType: 'fixed_asset',
              resourceId: r.fixedAssetId,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid disposal payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
