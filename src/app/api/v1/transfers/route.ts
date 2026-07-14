// GET  /api/v1/transfers        — list transfers
// POST /api/v1/transfers        — create a transfer

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { createTransfer } from '@/domain/commands/m2/Transfer';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const CreateTransferSchema = z.object({
  from_warehouse_id: z.string().uuid(),
  to_warehouse_id: z.string().uuid(),
  notes: z.string().optional(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    qty_requested: z.number().positive(),
  })).min(1),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'transfer.dispatch');
  await requirePermission(auth, 'inventory.read');
    const status = req.nextUrl.searchParams.get('status') ?? undefined;
    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.status = status;

    const transfers = await db.transfer.findMany({
      where, take: 50, orderBy: { requestedAt: 'desc' },
      include: {
        fromWarehouse: { select: { id: true, name: true, code: true } },
        toWarehouse: { select: { id: true, name: true, code: true } },
        _count: { select: { items: true } },
      },
    });

    return NextResponse.json({
      items: transfers.map(t => ({
        id: t.id, reference_no: t.referenceNo, status: t.status,
        from_warehouse: t.fromWarehouse, to_warehouse: t.toWarehouse,
        item_count: t._count.items,
        requested_at: t.requestedAt, dispatched_at: t.dispatchedAt, received_at: t.receivedAt,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    const body = CreateTransferSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/transfers', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'transfer.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const result = await createTransfer(tx, {
              companyId: auth.companyId,
              fromWarehouseId: body.from_warehouse_id,
              toWarehouseId: body.to_warehouse_id,
              requestedBy: auth.userId,
              notes: body.notes,
              items: body.items.map(i => ({ productId: i.product_id, qtyRequested: i.qty_requested })),
            }, correlationId);
            return { status: 201, body: result, resourceType: 'transfer', resourceId: result.transferId };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid transfer payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
