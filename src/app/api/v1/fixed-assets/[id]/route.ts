// GET /api/v1/fixed-assets/{id} — single fixed asset with depreciation history

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { DomainError } from '@/lib/errors/codes';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'asset.view.branch');
    const { id } = await params;

    const asset = await db.fixedAsset.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        category: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        depreciationRuns: { orderBy: { periodEnd: 'desc' }, take: 50 },
      },
    });
    if (!asset) throw new DomainError('RESOURCE_NOT_FOUND', 'Fixed asset not found', {}, 404);

    return NextResponse.json({
      id: asset.id,
      asset_code: asset.assetCode,
      name: asset.name,
      description: asset.description,
      category: asset.category,
      branch: asset.branch,
      location: asset.location,
      serial_number: asset.serialNumber,
      purchase_date: asset.purchaseDate,
      purchase_cost: asset.purchaseCost.toString(),
      salvage_value: asset.salvageValue.toString(),
      useful_life_months: asset.usefulLifeMonths,
      depreciation_method: asset.depreciationMethod,
      depreciation_rate: asset.depreciationRate?.toString() ?? null,
      accumulated_depreciation: asset.accumulatedDepreciation.toString(),
      net_book_value: asset.netBookValue.toString(),
      status: asset.status,
      disposed_at: asset.disposedAt,
      disposal_amount: asset.disposalAmount?.toString() ?? null,
      disposal_method: asset.disposalMethod,
      created_at: asset.createdAt,
      updated_at: asset.updatedAt,
      depreciation_runs: asset.depreciationRuns.map(r => ({
        id: r.id,
        period_start: r.periodStart,
        period_end: r.periodEnd,
        depreciation_amount: r.depreciationAmount.toString(),
        accumulated_after: r.accumulatedAfter.toString(),
        net_book_value_after: r.netBookValueAfter.toString(),
        posted_at: r.postedAt,
      })),
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
