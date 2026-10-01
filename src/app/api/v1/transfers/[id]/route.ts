import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'inventory.read');
    const { id } = await params;
    const transfer = await runInTenantContext(auth.ctx, async () => db.transfer.findFirst({
      where: { id, companyId: auth.companyId },
      include: { fromWarehouse: { select: { id: true, name: true, code: true } },
        toWarehouse: { select: { id: true, name: true, code: true } },
        items: { orderBy: { lineNo: 'asc' }, include: { product: { select: { id: true, name: true, code: true } }, serials: { include: { serial: { select: { serialNumber: true, status: true } } } } } } },
    }));
    if (!transfer) throw new DomainError('RESOURCE_NOT_FOUND', 'Transfer not found', {}, 404);
    const batches = await runInTenantContext(auth.ctx, async () => db.stockMovementBatch.findMany({
      where: { companyId: auth.companyId, stockMovement: { companyId: auth.companyId, referenceType: 'transfer', referenceId: transfer.id,
        warehouseId: transfer.fromWarehouseId, stockBucket: 'on_hand', movementType: 'transfer_dispatch' } },
      include: { productBatch: { select: { batchNo: true, expiryDate: true } }, stockMovement: { select: { sourceLineId: true } } },
    }));
    return NextResponse.json({ id: transfer.id, reference_no: transfer.referenceNo, status: transfer.status,
      from_warehouse: transfer.fromWarehouse, to_warehouse: transfer.toWarehouse, notes: transfer.notes,
      requested_at: transfer.requestedAt, dispatched_at: transfer.dispatchedAt, received_at: transfer.receivedAt,
      items: transfer.items.map(item => ({ id: item.id, product: item.product, serials: item.serials.map(link => ({ serial_number: link.serial.serialNumber, status: link.serial.status })),
        batches: batches.filter(batch => batch.stockMovement.sourceLineId === item.id).map(batch => ({ batch_no: batch.productBatch.batchNo, expiry_date: batch.productBatch.expiryDate, quantity: batch.qty.negated().toString() })),
        qty_requested: item.qtyRequested.toString(), qty_dispatched: item.qtyDispatched.toString(), qty_received: item.qtyReceived.toString() })) });
  } catch (error) { return errorResponse(error, getCorrelationId(req)); }
}
