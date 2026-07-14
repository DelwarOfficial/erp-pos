// GET  /api/v1/fixed-assets          — list fixed assets
// POST /api/v1/fixed-assets          — acquire a new fixed asset (postAssetAcquisition)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postAssetAcquisition } from '@/domain/commands/m4/AssetManagement';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const AssetAcquireSchema = z.object({
  branch_id: z.string().uuid().optional(),
  asset_code: z.string().min(1).max(60),
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  category_id: z.string().uuid().optional(),
  location: z.string().max(200).optional(),
  serial_number: z.string().max(120).optional(),
  purchase_date: z.string(),
  purchase_cost: z.number().positive(),
  salvage_value: z.number().min(0).default(0),
  useful_life_months: z.number().int().min(1).max(6000),
  depreciation_method: z.enum(['straight_line', 'declining_balance', 'units_of_production']).default('straight_line'),
  depreciation_rate: z.number().min(0).max(100).optional(),
  asset_account_id: z.string().uuid(),
  accum_dep_account_id: z.string().uuid(),
  dep_expense_account_id: z.string().uuid(),
  gain_loss_account_id: z.string().uuid().optional(),
  financial_account_id: z.string().uuid(),
  currency_code: z.string().length(3).default('BDT'),
  exchange_rate: z.number().positive().default(1.0),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'asset.view.branch');

    const url = req.nextUrl;
    const status = url.searchParams.get('status') ?? undefined;
    const search = url.searchParams.get('search') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { assetCode: { contains: search } },
        { name: { contains: search } },
        { serialNumber: { contains: search } },
      ];
    }

    const items = await db.fixedAsset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        category: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
    });

    return NextResponse.json({
      items: items.map(a => ({
        id: a.id,
        asset_code: a.assetCode,
        name: a.name,
        description: a.description,
        category: a.category,
        branch: a.branch,
        location: a.location,
        serial_number: a.serialNumber,
        purchase_date: a.purchaseDate,
        purchase_cost: a.purchaseCost.toString(),
        salvage_value: a.salvageValue.toString(),
        useful_life_months: a.usefulLifeMonths,
        depreciation_method: a.depreciationMethod,
        depreciation_rate: a.depreciationRate?.toString() ?? null,
        accumulated_depreciation: a.accumulatedDepreciation.toString(),
        net_book_value: a.netBookValue.toString(),
        status: a.status,
        disposed_at: a.disposedAt,
        disposal_amount: a.disposalAmount?.toString() ?? null,
        disposal_method: a.disposalMethod,
        created_at: a.createdAt,
      })),
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'asset.manage.branch');

    const idempotencyKey = requireIdempotencyKey(req);
    const body = AssetAcquireSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/fixed-assets', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'fixed_asset.acquire', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const r = await postAssetAcquisition(tx, {
              companyId: auth.companyId,
              branchId: body.branch_id,
              assetCode: body.asset_code,
              name: body.name,
              description: body.description,
              categoryId: body.category_id,
              location: body.location,
              serialNumber: body.serial_number,
              purchaseDate: new Date(body.purchase_date),
              purchaseCost: body.purchase_cost,
              salvageValue: body.salvage_value,
              usefulLifeMonths: body.useful_life_months,
              depreciationMethod: body.depreciation_method,
              depreciationRate: body.depreciation_rate,
              assetAccountId: body.asset_account_id,
              accumDepAccountId: body.accum_dep_account_id,
              depExpenseAccountId: body.dep_expense_account_id,
              gainLossAccountId: body.gain_loss_account_id,
              financialAccountId: body.financial_account_id,
              currencyCode: body.currency_code,
              exchangeRate: body.exchange_rate,
              createdBy: auth.userId!,
            }, correlationId);
            return {
              status: 201,
              body: {
                id: r.fixedAssetId,
                asset_code: r.assetCode,
                net_book_value: r.netBookValue,
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
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid fixed asset payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
