// GET  /api/v1/purchase-returns  — list purchase returns
// POST /api/v1/purchase-returns  — create + post a purchase return

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postPurchaseReturn } from '@/domain/commands/m2/PostPurchaseReturn';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const ReturnItemSchema = z.object({
  purchase_item_id: z.string().uuid(),
  qty_returned: z.number().positive(),
});

const PostPurchaseReturnSchema = z.object({
  branch_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  purchase_id: z.string().uuid(),
  supplier_id: z.string().uuid(),
  reason: z.string().min(1).max(2000),
  business_date: z.string().datetime().optional(),
  items: z.array(ReturnItemSchema).min(1),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'inventory.read');
    const url = req.nextUrl;
    const status = url.searchParams.get('status') ?? undefined;
    const supplierId = url.searchParams.get('supplier_id') ?? undefined;
    const purchaseId = url.searchParams.get('purchase_id') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (purchaseId) where.purchaseId = purchaseId;

    const [items, total] = await Promise.all([
      db.purchaseReturn.findMany({
        where, take: limit, skip: offset, orderBy: { createdAt: 'desc' },
        include: {
          supplier: { select: { id: true, name: true } },
          purchase: { select: { id: true, referenceNo: true } },
          _count: { select: { items: true } },
        },
      }),
      db.purchaseReturn.count({ where }),
    ]);

    return NextResponse.json({
      items: items.map(r => ({
        id: r.id, reference_no: r.referenceNo, status: r.status,
        supplier: r.supplier, purchase: r.purchase,
        business_date: r.businessDate, reason: r.reason,
        subtotal_credit: r.subtotalCredit.toString(),
        tax_credit: r.taxCredit.toString(),
        total_credit: r.totalCredit.toString(),
        base_total_credit: r.baseTotalCredit.toString(),
        refund_status: r.refundStatus,
        item_count: r._count.items,
        posted_at: r.postedAt, created_at: r.createdAt,
      })),
      total, limit, offset,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'purchase_return.post');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = PostPurchaseReturnSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/purchase-returns', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'purchase_return.post', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const out = await postPurchaseReturn(tx, {
              companyId: auth.companyId, branchId: body.branch_id, warehouseId: body.warehouse_id,
              purchaseId: body.purchase_id, supplierId: body.supplier_id,
              postedBy: auth.userId,
              businessDate: body.business_date ? new Date(body.business_date) : new Date(),
              reason: body.reason,
              items: body.items.map(i => ({
                purchaseItemId: i.purchase_item_id,
                qtyReturned: i.qty_returned,
              })),
            }, correlationId);
            return {
              status: 201,
              body: {
                id: out.returnId, reference_no: out.referenceNo, status: out.status,
                total_credit: out.totalCredit,
              },
              resourceType: 'purchase_return', resourceId: out.returnId,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid purchase return payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
