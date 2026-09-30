import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { actOnStockAdjustment } from '@/domain/commands/m2/PostStockAdjustment';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateRequest(); await requirePermission(auth, 'inventory.read'); const { id } = await params;
    const data = await runInTenantContext(auth.ctx, async () => {
      const adjustment = await db.stockAdjustment.findFirst({ where: { id, companyId: auth.companyId }, include: {
        warehouse: { select: { id: true, name: true, code: true } }, branch: { select: { id: true, name: true } }, reasonCode: { select: { id: true, name: true } },
        items: { orderBy: { lineNo: 'asc' }, include: { product: { select: { id: true, name: true, code: true } }, batch: { select: { batchNo: true } }, serials: { include: { serial: { select: { serialNumber: true, status: true } } } } } },
      } });
      if (!adjustment) throw new DomainError('RESOURCE_NOT_FOUND', 'Adjustment not found', {}, 404);
      const approval = adjustment.approvalRequestId ? await db.approvalRequest.findFirst({ where: { id: adjustment.approvalRequestId, companyId: auth.companyId }, select: { id: true, status: true, requestedBy: true, reason: true } }) : null;
      return { id: adjustment.id, reference_no: adjustment.referenceNo, status: adjustment.status, adjustment_type: adjustment.adjustmentType, warehouse: adjustment.warehouse,
        branch: adjustment.branch, reason: adjustment.reasonCode, notes: adjustment.notes, business_date: adjustment.businessDate, posted_at: adjustment.postedAt, journal_entry_id: adjustment.journalEntryId, approval,
        items: adjustment.items.map(item => ({ id: item.id, product: item.product, batch: item.batch?.batchNo, quantity: item.quantityDelta.toString(), unit_cost: item.unitCostSnapshot.toString(), value: item.valueDelta.toString(), serials: item.serials.map(link => ({ number: link.serial.serialNumber, status: link.serial.status })) })) };
    });
    return NextResponse.json(data);
  } catch (error) { return errorResponse(error, getCorrelationId(req)); }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest(); await requirePermission(auth, 'stock_adjustment.post'); const { id } = await params;
    const body = z.object({ action: z.enum(['post', 'cancel']) }).parse(await req.json()); const idempotencyKey = requireIdempotencyKey(req);
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, tx => withIdempotency({ companyId: auth.companyId, userId: auth.userId, idempotencyKey, operation: `stock_adjustment.${body.action}`, requestHash: computeRequestHash({ method: 'POST', path: `/api/v1/stock-adjustments/${id}`, body }) }, async () => {
      const data = await actOnStockAdjustment(tx, { companyId: auth.companyId, userId: auth.userId, id, action: body.action }, correlationId);
      return { status: 200, body: data, resourceType: 'stock_adjustment', resourceId: id };
    }, tx)));
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { return errorResponse(error instanceof z.ZodError ? new DomainError('VALIDATION_FAILED', 'Invalid adjustment action', {}, 400) : error, correlationId); }
}
