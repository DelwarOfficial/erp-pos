// GET  /api/v1/sale-returns  — list sale returns
// POST /api/v1/sale-returns  — post a sale return (creates + posts in one call)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postSaleReturn } from '@/domain/commands/m3/PostSaleReturn';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { enforceLargeRefundGate } from '@/lib/approval/refundGate';
import { Prisma } from '@prisma/client';

const ReturnItemSchema = z.object({
  sale_item_id: z.string().uuid(),
  qty_returned: z.number().positive(),
  condition: z.enum(['resalable', 'damaged', 'repair', 'scrap']),
  serials: z.array(z.string()).optional(),
});

const PostSaleReturnSchema = z.object({
  sale_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  disposition: z.enum(['restock', 'damaged', 'repair', 'scrap', 'mixed']),
  reason: z.string().min(1).max(2000),
  items: z.array(ReturnItemSchema).min(1),
  // Required once the sale's return credit reaches the refund approval
  // threshold (src/lib/approval/refundGate.ts).
  approval_request_id: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, "sale.read");
    const returns = await runInTenantContext(auth.ctx, async () => {
      return db.saleReturn.findMany({
        where: { companyId: auth.companyId },
        take: 50, orderBy: { createdAt: 'desc' },
        include: {
          sale: { select: { id: true, referenceNo: true, grandTotal: true } },
          _count: { select: { items: true } },
        },
      });
    });
    return NextResponse.json({
      items: returns.map(r => ({
        id: r.id, reference_no: r.referenceNo, status: r.status,
        sale: r.sale, disposition: r.disposition,
        total_credit: r.totalCredit.toString(),
        item_count: r._count.items,
        business_date: r.businessDate, posted_at: r.postedAt,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, "sale_return.post");
    const idempotencyKey = requireIdempotencyKey(req);
    const body = PostSaleReturnSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/sale-returns', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async (tx) =>
        withIdempotency(
          { idempotencyKey, operation: 'sale_return.post', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const result = await postSaleReturn(tx, {
              saleId: body.sale_id,
              companyId: auth.companyId,
              branchId: body.branch_id,
              warehouseId: body.warehouse_id,
              postedBy: auth.userId,
              businessDate: new Date(),
              disposition: body.disposition,
              reason: body.reason,
              items: body.items.map(i => ({
                saleItemId: i.sale_item_id,
                qtyReturned: i.qty_returned,
                condition: i.condition,
                serials: i.serials,
              })),
            }, correlationId);
            // Return credit funds the cash refund, so large returns pass the
            // same gate as the refund itself. Checked after posting, inside
            // the transaction: a refusal rolls the whole return back.
            const credited = await tx.saleReturn.aggregate({
              where: { companyId: auth.companyId, saleId: body.sale_id, status: { in: ['posted', 'approved'] } },
              _sum: { baseTotalCredit: true },
            });
            const gate = await enforceLargeRefundGate(tx, req, {
              companyId: auth.companyId, userId: auth.userId!, saleId: body.sale_id,
              totalBase: new Prisma.Decimal(credited._sum.baseTotalCredit ?? 0),
              approvalRequestId: body.approval_request_id,
            });
            if (gate.approvalRequestId) {
              await tx.auditLog.create({
                data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                  action: 'sale_return.large_refund_approved', entityType: 'sale_return', entityId: result.saleReturnId,
                  afterValue: JSON.stringify({ sale_id: body.sale_id, return_credit_total_base: gate.totalBase, threshold: gate.threshold,
                    approval_request_id: gate.approvalRequestId, approved_by: gate.approvedBy }) },
              });
            }
            return { status: 201, body: result, resourceType: 'sale_return', resourceId: result.saleReturnId };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid sale return payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
