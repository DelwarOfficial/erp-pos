import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { PostSaleSchema } from '@/lib/sales/saleRequest';
import { priceSaleItem } from '@/domain/tax/priceSaleItem';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const PricingSchema = PostSaleSchema.pick({ items: true });
/** Read-only pricing preview. Checkout still revalidates prices, stock, permissions and payments. */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateRequest(); await requirePermission(auth, 'sale.post');
    const body = PricingSchema.parse(await req.json());
    const products = await runInTenantContext(auth.ctx, async () => db.product.findMany({
      where: { companyId: auth.companyId, id: { in: [...new Set(body.items.map(item => item.product_id))] }, isActive: true, deletedAt: null },
      include: { defaultTaxCode: { include: { components: { include: { taxComponent: true } } } } },
    }));
    let subtotal = new Prisma.Decimal(0); let discount = new Prisma.Decimal(0); let tax = new Prisma.Decimal(0);
    for (const item of body.items) {
      const product = products.find(product => product.id === item.product_id);
      if (!product) throw new DomainError('RESOURCE_NOT_FOUND', 'Product not found or inactive', {}, 404);
      const line = priceSaleItem(product, { qty: item.qty, unitPrice: item.unit_price, discountAmount: item.discount_amount }, new Date());
      subtotal = subtotal.plus(line.grossAmount); discount = discount.plus(line.discountAmount); tax = tax.plus(line.taxAmount);
    }
    return NextResponse.json({ subtotal: subtotal.toString(), discount_total: discount.toString(), tax_total: tax.toString(), grand_total: subtotal.minus(discount).plus(tax).toString() });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid cart', { issues: error.issues }, 400), getCorrelationId(req));
    return errorResponse(error, getCorrelationId(req));
  }
}
