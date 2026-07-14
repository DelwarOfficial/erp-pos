// GET  /api/v1/purchases/{id}/receivings  — list receivings for a purchase
// POST /api/v1/purchases/{id}/receivings  — receive stock against a purchase

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { receivePurchase } from '@/domain/commands/m2/ReceivePurchase';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const ReceivingItemSchema = z.object({
  purchase_item_id: z.string().uuid(),
  qty_received_now: z.number().positive(),
  batch_no: z.string().optional(),
  manufactured_at: z.string().datetime().optional(),
  expiry_date: z.string().datetime().optional(),
  serials: z.array(z.string()).optional(),
});

const ReceivingSchema = z.object({
  business_date: z.string().datetime(),
  supplier_document_no: z.string().max(100).optional(),
  notes: z.string().optional(),
  items: z.array(ReceivingItemSchema).min(1),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'purchase.receive');
  await requirePermission(auth, 'inventory.read');
    const { id } = await params;
    const receivings = await db.purchaseReceiving.findMany({
      where: { purchaseId: id, companyId: auth.companyId },
      orderBy: { receivedAt: 'desc' },
      include: {
        _count: { select: { items: true } },
        receivedByUser: { select: { id: true, name: true, email: true } },
      },
    });
    return NextResponse.json({
      items: receivings.map(r => ({
        id: r.id,
        reference_no: r.referenceNo,
        receiving_status: r.receivingStatus,
        business_date: r.businessDate,
        received_at: r.receivedAt,
        posted_at: r.postedAt,
        supplier_document_no: r.supplierDocumentNo,
        item_count: r._count.items,
        received_by: r.receivedByUser,
      })),
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = ReceivingSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/purchases/${id}/receivings`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'purchase.receive', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // Load purchase to get warehouse/branch
            const purchase = await tx.purchase.findFirst({
              where: { id, companyId: auth.companyId },
            });
            if (!purchase) throw new DomainError('RESOURCE_NOT_FOUND', 'Purchase not found', {}, 404);

            const result = await receivePurchase(tx, {
              purchaseId: id,
              companyId: auth.companyId,
              branchId: purchase.branchId,
              warehouseId: purchase.warehouseId,
              receivedBy: auth.userId,
              businessDate: new Date(body.business_date),
              supplierDocumentNo: body.supplier_document_no,
              notes: body.notes,
              items: body.items.map(i => ({
                purchaseItemId: i.purchase_item_id,
                qtyReceivedNow: i.qty_received_now,
                batchNo: i.batch_no,
                manufacturedAt: i.manufactured_at ? new Date(i.manufactured_at) : undefined,
                expiryDate: i.expiry_date ? new Date(i.expiry_date) : undefined,
                serials: i.serials,
              })),
            }, correlationId);

            return {
              status: 201,
              body: {
                receiving_id: result.receivingId,
                reference_no: result.referenceNo,
                status: result.status,
                purchase_new_status: result.purchaseNewStatus,
                items: result.items,
              },
              resourceType: 'purchase_receiving',
              resourceId: result.receivingId,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid receiving payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
