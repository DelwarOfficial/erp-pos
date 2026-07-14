// POST /api/v1/courier-settlements — post a COD settlement batch

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postCourierCodSettlement } from '@/domain/commands/m5/PostCourierCodSettlement';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const SettlementItemSchema = z.object({
  delivery_order_id: z.string().uuid(),
  cod_amount: z.number().min(0),
  fee_amount: z.number().min(0).default(0),
  adjustment_amount: z.number().default(0),
});

const SettlementSchema = z.object({
  branch_id: z.string().uuid(),
  courier_code: z.string().min(1).max(50),
  settlement_date: z.string().datetime(),
  financial_account_id: z.string().uuid(),
  items: z.array(SettlementItemSchema).min(1),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'courier_cod.settle');
  await requirePermission(auth, 'inventory.read');
    const settlements = await db.courierCodSettlement.findMany({
      where: { companyId: auth.companyId },
      take: 50, orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
    return NextResponse.json({
      items: settlements.map(s => ({
        id: s.id, reference_no: s.referenceNo, status: s.status,
        courier_code: s.courierCode, settlement_date: s.settlementDate,
        gross_cod: s.grossCodAmount.toString(), fee: s.feeAmount.toString(),
        adjustment: s.adjustmentAmount.toString(), net_received: s.netReceivedAmount.toString(),
        item_count: s._count.items,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    const body = SettlementSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/courier-settlements', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'courier_cod_settlement.post', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const result = await postCourierCodSettlement(tx, {
              companyId: auth.companyId, branchId: body.branch_id,
              courierCode: body.courier_code,
              settlementDate: new Date(body.settlement_date),
              financialAccountId: body.financial_account_id,
              postedBy: auth.userId,
              items: body.items.map(i => ({
                deliveryOrderId: i.delivery_order_id,
                codAmount: i.cod_amount, feeAmount: i.fee_amount,
                adjustmentAmount: i.adjustment_amount,
              })),
            }, correlationId);
            return { status: 201, body: result, resourceType: 'courier_cod_settlement', resourceId: result.settlementId };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid settlement payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
