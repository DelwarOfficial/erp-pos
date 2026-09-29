import { Prisma } from '@prisma/client';
import { computeLineTax } from './computeLineTax';

type PricedProduct = Prisma.ProductGetPayload<{ include: { defaultTaxCode: { include: { components: { include: { taxComponent: true } } } } } }>;

/** Shared by POS pricing and the posting command; taxes never originate in the browser. */
export function priceSaleItem(product: PricedProduct, item: { qty: number; unitPrice: number; discountAmount?: number }, asOf: Date) {
  const grossAmount = new Prisma.Decimal(item.qty).mul(item.unitPrice);
  const discountAmount = new Prisma.Decimal(item.discountAmount ?? 0);
  return { grossAmount, discountAmount, ...computeLineTax({
    grossAmount, discountAmount,
    components: (product.defaultTaxCode?.components ?? []).map(tc => ({
      taxComponentId: tc.taxComponentId, componentCode: tc.taxComponent.componentCode,
      rate: tc.taxComponent.rate, calculationOrder: tc.taxComponent.calculationOrder,
      compoundOnPrevious: tc.taxComponent.compoundOnPrevious, effectiveFrom: tc.taxComponent.effectiveFrom,
      effectiveTo: tc.taxComponent.effectiveTo, outputAccountId: tc.taxComponent.outputAccountId,
    })), priceIncludesTax: product.defaultTaxCode?.priceIncludesTax ?? false, asOf,
  }) };
}
