import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';

const Decimal = Prisma.Decimal.clone({ precision: 65 });

/** Historical-cost reversal changes both quantity and value. Reusing the current
 * average after an intervening receipt would manufacture/destroy inventory value.
 * MariaDB stores 30 fractional digits; any residual at zero quantity must be
 * explicitly resolved, never silently discarded here.
 */
export function projectStockValue(input: {
  quantity: string; averageCost: string; quantityDelta: string; movementUnitCost: string;
}): { quantity: string; averageCost: string; valueDelta: string } {
  const quantity = new Decimal(input.quantity);
  const average = new Decimal(input.averageCost);
  const delta = new Decimal(input.quantityDelta);
  const cost = new Decimal(input.movementUnitCost);
  if (![quantity, average, delta, cost].every(value => value.isFinite()) || cost.lt(0) || delta.isZero()) {
    throw new DomainError('VALIDATION_FAILED', 'Finite quantity and nonnegative valuation required', {}, 400);
  }
  const nextQuantity = quantity.plus(delta);
  const valueDelta = delta.mul(cost).toDecimalPlaces(30);
  const nextValue = quantity.mul(average).plus(valueDelta).toDecimalPlaces(30);
  if (nextQuantity.lt(0)) throw new DomainError('INVENTORY_INSUFFICIENT', 'Movement exceeds stock quantity', {}, 409);
  if (nextValue.lt(0) || (nextQuantity.isZero() && !nextValue.isZero())) {
    throw new DomainError('VALIDATION_FAILED', 'Historical-cost reversal requires an explicit inventory valuation adjustment', {}, 409);
  }
  return {
    quantity: nextQuantity.toString(), valueDelta: valueDelta.toString(),
    averageCost: nextQuantity.isZero() ? '0' : nextValue.div(nextQuantity).toDecimalPlaces(30).toString(),
  };
}
