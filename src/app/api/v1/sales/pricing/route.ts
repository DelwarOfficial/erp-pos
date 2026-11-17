import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { requireIdempotencyKey } from '@/lib/idempotency';
import { PostSaleSchema } from '@/lib/sales/saleRequest';
import { priceSaleItem } from '@/domain/tax/priceSaleItem';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const PricingSchema = PostSaleSchema.pick({ items: true });
/** Read-only pricing preview. Checkout still revalidates prices, stock, permissions and payments. */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateRequest(); await requirePermission(auth, 'sale.post');
    requireIdempotencyKey(req); // required on every POST; a preview stores nothing, so it is not recorded
    const body = PricingSchema.parse(await req.json());
    const products = await runInTenantContext(auth.ctx, async () => db.product.findMany({
      where: { companyId: auth.companyId, id: { in: [...new Set(body.items.map(item => item.product_id))] }, isActive: true, deletedAt: null },
      include: { defaultTaxCode: { include: { components: { include: { taxComponent: true } } } } },
    }));
    let subtotal = new Prisma.Decimal(0); let discount = new Prisma.Decimal(0); let tax = new Prisma.Decimal(0);
    // Per line, as posting would compute it (gross, discount, tax, total), so
    // the till shows the server's figures rather than its own arithmetic.
    const lines: Array<Record<string, string>> = [];
    for (const item of body.items) {
      const product = products.find(product => product.id === item.product_id);
      if (!product) throw new DomainError('RESOURCE_NOT_FOUND', 'Product not found or inactive', {}, 404);
      const line = priceSaleItem(product, { qty: item.qty, unitPrice: item.unit_price, discountAmount: item.discount_amount }, new Date());
      subtotal = subtotal.plus(line.grossAmount); discount = discount.plus(line.discountAmount); tax = tax.plus(line.taxAmount);
      lines.push({ product_id: item.product_id, qty: String(item.qty), unit_price: String(item.unit_price), list_price: product.defaultPrice.toString(),
        gross_amount: line.grossAmount.toFixed(2), discount_amount: line.discountAmount.toFixed(2), taxable_amount: new Prisma.Decimal(line.taxableAmount).toFixed(2),
        tax_amount: new Prisma.Decimal(line.taxAmount).toFixed(2), line_total: new Prisma.Decimal(line.lineTotal).toFixed(2) });
    }
    return NextResponse.json({ subtotal: subtotal.toString(), discount_total: discount.toString(), tax_total: tax.toString(), grand_total: subtotal.minus(discount).plus(tax).toString(), lines });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid cart', { issues: error.issues }, 400), getCorrelationId(req));
    return errorResponse(error, getCorrelationId(req));
  }
}
