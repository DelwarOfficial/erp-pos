// POST /api/v1/inventory/opening-stock
// Post opening stock balances for a warehouse (§7.23).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postOpeningStock } from '@/domain/commands/m2/PostOpeningStock';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const OpeningStockItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().positive(),
  unit_cost: z.number().min(0),
  batch_no: z.string().optional(),
  expiry_date: z.string().datetime().optional(),
  serials: z.array(z.string()).optional(),
});

const OpeningStockSchema = z.object({
  warehouse_id: z.string().uuid(),
  business_date: z.string().datetime(),
  reference_no: z.string().min(1).max(60),
  notes: z.string().optional(),
  items: z.array(OpeningStockItemSchema).min(1),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'opening_stock.post');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = OpeningStockSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/inventory/opening-stock', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'opening_stock.post', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // Validate warehouse belongs to this company
            const warehouse = await tx.warehouse.findFirst({
              where: { id: body.warehouse_id, companyId: auth.companyId },
            });
            if (!warehouse) throw new DomainError('VALIDATION_FAILED', 'Warehouse not found', {}, 404);

            // Check reference_no uniqueness
            const existingRef = await tx.stockMovement.findFirst({
              where: { companyId: auth.companyId, referenceType: 'opening_stock', referenceId: body.reference_no },
            });
            if (existingRef) {
              throw new DomainError('VALIDATION_FAILED', `Reference no ${body.reference_no} already used`, {}, 409);
            }

            const result = await postOpeningStock(tx, {
              companyId: auth.companyId,
              warehouseId: body.warehouse_id,
              postedBy: auth.userId,
              businessDate: new Date(body.business_date),
              referenceNo: body.reference_no,
              notes: body.notes,
              items: body.items.map(i => ({
                productId: i.product_id,
                quantity: i.quantity,
                unitCost: i.unit_cost,
                batchNo: i.batch_no,
                expiryDate: i.expiry_date ? new Date(i.expiry_date) : undefined,
                serials: i.serials,
              })),
            }, correlationId);

            return {
              status: 201,
              body: {
                event_id: result.event_id,
                reference_no: body.reference_no,
                item_count: result.items.length,
                items: result.items,
              },
              resourceType: 'opening_stock',
              resourceId: body.reference_no,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid opening stock payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
