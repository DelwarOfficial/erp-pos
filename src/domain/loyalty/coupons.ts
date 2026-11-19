// Coupons: a code worth a fixed ৳ amount or a % off a sale.
//
// One coupon per sale. It applies to the sale's value after each line's own
// discount and before tax, and is spread over the lines in proportion to their
// value (the paisa left by rounding go on the last line), so each line's tax is
// worked out on its discounted price exactly as for any line discount. The
// pricing preview and posting both use couponDiscount(), so the till shows
// what posting does.
//
// Rules a coupon carries: active, valid from/to, minimum spend, a cap on a %
// discount, and a total use limit (counted when a sale posts, given back when
// it is voided).

import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';

type Client = Pick<Prisma.TransactionClient, 'coupon'>;

export interface CouponLine { qty: number; unitPrice: number; discountAmount?: number }

export async function couponDiscount(tx: Client, companyId: string, code: string, lines: CouponLine[], at = new Date()) {
  const coupon = await tx.coupon.findFirst({ where: { companyId, code: code.trim().toUpperCase() } });
  if (!coupon || !coupon.isActive) throw new DomainError('VALIDATION_FAILED', 'That coupon code is not valid', { code }, 404);
  if (coupon.validFrom > at) throw new DomainError('VALIDATION_FAILED', 'That coupon is not valid yet', {}, 409);
  if (coupon.validTo && coupon.validTo < at) throw new DomainError('VALIDATION_FAILED', 'That coupon has expired', {}, 409);
  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) throw new DomainError('VALIDATION_FAILED', 'That coupon has been used up', {}, 409);

  const nets = lines.map(l => Prisma.Decimal.max(0, new Prisma.Decimal(l.qty).mul(l.unitPrice).minus(l.discountAmount ?? 0)));
  const base = nets.reduce((t, n) => t.plus(n), new Prisma.Decimal(0));
  if (base.lt(coupon.minOrderAmount)) {
    throw new DomainError('VALIDATION_FAILED', `This coupon needs a sale of at least ৳${new Prisma.Decimal(coupon.minOrderAmount).toFixed(2)}`, {}, 409);
  }
  let discount = coupon.discountType === 'fixed'
    ? Prisma.Decimal.min(coupon.value, base)
    : base.mul(coupon.value).div(100);
  if (coupon.discountType !== 'fixed' && coupon.maxDiscountAmount !== null) discount = Prisma.Decimal.min(discount, coupon.maxDiscountAmount);
  discount = discount.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);

  // Spread over the lines by value; the rounding remainder goes on the last line with value.
  const perLine = nets.map(() => new Prisma.Decimal(0));
  const lastIndex = nets.map((n, i) => (n.gt(0) ? i : -1)).filter(i => i >= 0).pop();
  let left = discount;
  nets.forEach((n, i) => {
    if (!n.gt(0) || base.isZero()) return;
    const share = i === lastIndex ? left : discount.mul(n).div(base).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    perLine[i] = Prisma.Decimal.min(share, n);
    left = left.minus(perLine[i]);
  });
  return { couponId: coupon.id, code: coupon.code, name: coupon.name, discount, perLine };
}
