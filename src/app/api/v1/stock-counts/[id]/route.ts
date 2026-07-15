// GET /api/v1/stock-counts/{id} — fetch a single stock count with items + serials

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'inventory.read');
    const { id } = await params;

    const sc = await db.stockCount.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        branch: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { id: true, code: true, name: true } },
            batch: { select: { id: true, batchNo: true } },
            reasonCode: { select: { id: true, code: true, name: true } },
          },
          orderBy: { productId: 'asc' },
        },
      },
    });
    if (!sc) throw new DomainError('RESOURCE_NOT_FOUND', 'Stock count not found', {}, 404);

    return NextResponse.json({
      item: {
        id: sc.id, reference_no: sc.referenceNo, status: sc.status,
        branch: sc.branch, warehouse: sc.warehouse,
        scope_type: sc.scopeType, category: sc.category, brand: sc.brand,
        blind_count: sc.blindCount, movement_freeze_policy: sc.movementFreezePolicy,
        snapshot_at: sc.snapshotAt, notes: sc.notes,
        created_by: sc.createdBy, reviewed_by: sc.reviewedBy, posted_by: sc.postedBy,
        created_at: sc.createdAt, posted_at: sc.postedAt,
        items: sc.items.map((it, idx) => ({
          id: it.id, line_no: idx + 1,
          product: it.product, batch: it.batch,
          expected_quantity: it.expectedQuantity.toString(),
          counted_quantity: it.countedQuantity?.toString() ?? null,
          variance_quantity: it.varianceQuantity?.toString() ?? null,
          reason_code: it.reasonCode,
          count_note: it.countNote,
        })),
      },
    });
  } catch (e) { return errorResponse(e, correlationId); }
}
