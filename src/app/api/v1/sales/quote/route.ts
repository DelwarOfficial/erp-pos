// POST /api/v1/sales/quote — what POST /api/v1/sales would post, without posting it.
//
// Runs the real PostSale inside a transaction that is always rolled back, and
// returns the exact tax-inclusive total, the unpaid amount and the payment
// schedule. The credit-sale screen previews the schedule from this, so the
// browser never computes money: whatever it shows is what posting will do,
// computed by the same code. Nothing is written -- not the sale, not a
// document number, not stock. The idempotency key is required as on every
// mutating route; since nothing persists, nothing is stored against it.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { postSale } from '@/domain/commands/m3/PostSale';
import { PostSaleSchema, postSaleInput } from '@/lib/sales/saleRequest';

class QuoteReady extends Error {
  constructor(readonly quote: unknown) { super('quote'); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'sale.post');
    requireIdempotencyKey(req);
    const body = PostSaleSchema.parse(await req.json());
    try {
      await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => {
        const sale = await postSale(tx, postSaleInput(body, auth), correlationId);
        const installments = await tx.installment.findMany({ where: { saleId: sale.saleId }, orderBy: { installmentNo: 'asc' } });
        const saleRow = await tx.sale.findUniqueOrThrow({ where: { id: sale.saleId }, select: { customerPhoneSnapshot: true } });
        const unpaid = installments.reduce((s, i) => s.plus(i.amount), new Prisma.Decimal(0));
        throw new QuoteReady({
          subtotal: new Prisma.Decimal(sale.subtotal).toFixed(2), discount_total: new Prisma.Decimal(sale.discountTotal).toFixed(2),
          tax_total: new Prisma.Decimal(sale.taxTotal).toFixed(2), grand_total: new Prisma.Decimal(sale.grandTotal).toFixed(2),
          paid_now: new Prisma.Decimal(sale.grandTotal).minus(unpaid).toFixed(2), unpaid: unpaid.toFixed(2),
          reminder_phone: saleRow.customerPhoneSnapshot,
          schedule: installments.map(i => ({ installment_no: i.installmentNo, due_date: i.dueDate.toISOString().slice(0, 10), amount: i.amount.toFixed(2) })),
        });
      }));
    } catch (e) {
      if (e instanceof QuoteReady) return NextResponse.json(e.quote);
      throw e;
    }
    throw new Error('quote was not produced');
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid sale', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
