// POST /api/v1/quotations/{id}/convert — convert a quotation to a sale (calls postSale)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postSale } from '@/domain/commands/m3/PostSale';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { db } from '@/lib/db';

const ConvertSchema = z.object({
  warehouse_id: z.string().uuid(),
  cashier_shift_id: z.string().uuid().optional(),
  payments: z.array(z.object({
    payment_method: z.enum(['cash', 'card', 'cheque', 'bkash', 'nagad', 'rocket', 'bank_transfer', 'gift_card', 'store_credit', 'other']),
    amount: z.number().positive(),
    financial_account_id: z.string().uuid(),
    method_reference: z.string().max(120).optional(),
  })).min(1),
  sale_note: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'sale.post');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = ConvertSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/quotations/${id}/convert`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'quotation.convert', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const quotation = await tx.quotation.findFirst({
              where: { id, companyId: auth.companyId },
              include: { items: true },
            });
            if (!quotation) throw new DomainError('RESOURCE_NOT_FOUND', 'Quotation not found', {}, 404);
            if (quotation.status === 'converted') {
              throw new DomainError('VALIDATION_FAILED', 'Quotation already converted', { sale_id: quotation.convertedSaleId }, 409);
            }
            if (quotation.validUntil && quotation.validUntil < new Date()) {
              throw new DomainError('VALIDATION_FAILED', 'Quotation has expired', { valid_until: quotation.validUntil }, 409);
            }

            const saleResult = await postSale(tx, {
              companyId: auth.companyId,
              branchId: quotation.branchId,
              warehouseId: body.warehouse_id,
              cashierId: auth.userId,
              cashierShiftId: body.cashier_shift_id,
              customerId: quotation.customerId ?? undefined,
              currencyCode: quotation.currencyCode,
              exchangeRate: parseFloat(quotation.exchangeRate.toString()),
              businessDate: new Date(),
              saleNote: body.sale_note ?? quotation.notes ?? undefined,
              items: quotation.items.map(it => ({
                productId: it.productId,
                qty: parseFloat(it.qty.toString()),
                unitPrice: parseFloat(it.unitPrice.toString()),
                discountAmount: parseFloat(it.discountAmount.toString()),
              })),
              payments: body.payments.map(p => ({
                paymentMethod: p.payment_method,
                amount: p.amount,
                financialAccountId: p.financial_account_id,
                methodReference: p.method_reference,
              })),
            }, correlationId);

            await tx.quotation.update({
              where: { id: quotation.id },
              data: { status: 'converted', convertedSaleId: saleResult.saleId },
            });

            return {
              status: 201,
              body: { sale: saleResult, quotation_id: quotation.id, status: 'converted' },
              resourceType: 'sale', resourceId: saleResult.saleId,
            };
          });
        },
      ),
    );

    // Best-effort: log conversion outside of idempotency window
    void (async () => {
      try {
        await db.auditLog.create({
          data: { companyId: auth.companyId, userId: auth.userId, correlationId,
            action: 'quotation.convert', entityType: 'quotation', entityId: id,
            afterValue: JSON.stringify({ sale_id: (result.body as any).sale.saleId }) },
        });
      } catch { /* best-effort */ }
    })();

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid convert payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
