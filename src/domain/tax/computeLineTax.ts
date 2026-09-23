// Single tax computation used by every document line.
//
// Three settings that the schema has always carried were previously ignored by
// the posting path, which summed every component flat against the same base and
// treated every price as tax-exclusive:
//
//   TaxCode.priceIncludesTax        -- the shelf price already contains the tax
//   TaxComponent.calculationOrder   -- the order components are applied in
//   TaxComponent.compoundOnPrevious -- this component is charged on base + the
//                                      tax accumulated by earlier components
//
// Effective dating (effectiveFrom / effectiveTo) was likewise unfiltered, so a
// backdated document was taxed at whatever rate happened to be current.
//
// All arithmetic is Prisma.Decimal. Nothing is rounded here: rounding belongs at
// a single defined boundary, and these values feed journal lines that must sum
// exactly. The inclusive-price path allocates its division residual to the last
// component so that taxableAmount + sum(component tax) equals the gross to the
// last digit.

import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';

const Decimal = Prisma.Decimal.clone({ precision: 65 });
const HUNDRED = new Decimal(100);

export interface TaxComponentSpec {
  taxComponentId: string;
  componentCode: string;
  rate: Prisma.Decimal | string | number;
  calculationOrder: number;
  compoundOnPrevious: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  outputAccountId: string | null;
  inputAccountId?: string | null;
}

export interface ComputedComponentTax {
  taxComponentId: string;
  componentCode: string;
  rate: Prisma.Decimal;
  /** The base this component was actually charged on (includes earlier tax when compounded). */
  taxableBase: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  outputAccountId: string | null;
  inputAccountId?: string | null;
}

export interface ComputedLineTax {
  /** Net of tax and discount. This is the revenue figure. */
  taxableAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  /** taxableAmount + taxAmount. Equals the gross when the price includes tax. */
  lineTotal: Prisma.Decimal;
  components: ComputedComponentTax[];
}

/** Components in force on the given date, in the order they must be applied. */
export function applicableComponents(
  components: readonly TaxComponentSpec[],
  asOf: Date,
): TaxComponentSpec[] {
  return components
    .filter((component) => {
      if (component.effectiveFrom > asOf) return false;
      if (component.effectiveTo && component.effectiveTo <= asOf) return false;
      return true;
    })
    .slice()
    .sort((a, b) => a.calculationOrder - b.calculationOrder
      || a.componentCode.localeCompare(b.componentCode));
}

/**
 * Apply the component sequence to a known tax-exclusive base.
 * Returns each component's own base and tax.
 */
function applySequence(
  base: Prisma.Decimal,
  components: readonly TaxComponentSpec[],
): { total: Prisma.Decimal; parts: Array<{ spec: TaxComponentSpec; taxableBase: Prisma.Decimal; taxAmount: Prisma.Decimal }> } {
  let accumulated = new Decimal(0);
  const parts: Array<{ spec: TaxComponentSpec; taxableBase: Prisma.Decimal; taxAmount: Prisma.Decimal }> = [];

  for (const spec of components) {
    const rate = new Decimal(spec.rate.toString());
    if (!rate.isFinite() || rate.lt(0)) {
      throw new DomainError('VALIDATION_FAILED', `Tax component ${spec.componentCode} has an invalid rate`, { component: spec.componentCode }, 400);
    }
    const taxableBase = spec.compoundOnPrevious ? base.plus(accumulated) : base;
    const taxAmount = taxableBase.mul(rate).div(HUNDRED);
    accumulated = accumulated.plus(taxAmount);
    parts.push({ spec, taxableBase, taxAmount });
  }

  return { total: accumulated, parts };
}

export function computeLineTax(params: {
  /** qty * unitPrice, before discount. Tax-inclusive when priceIncludesTax is true. */
  grossAmount: Prisma.Decimal | string | number;
  discountAmount: Prisma.Decimal | string | number;
  components: readonly TaxComponentSpec[];
  priceIncludesTax: boolean;
  /** The document's business date. Rates are resolved as of this date, not today. */
  asOf: Date;
}): ComputedLineTax {
  const gross = new Decimal(params.grossAmount.toString());
  const discount = new Decimal(params.discountAmount.toString());

  if (!gross.isFinite() || gross.lt(0)) {
    throw new DomainError('VALIDATION_FAILED', 'Line gross amount must be a non-negative number', {}, 400);
  }
  if (!discount.isFinite() || discount.lt(0) || discount.gt(gross)) {
    throw new DomainError('VALIDATION_FAILED', 'Discount must be between zero and the line gross amount', {}, 400);
  }

  const inScope = applicableComponents(params.components, params.asOf);
  const net = gross.minus(discount);

  if (inScope.length === 0 || net.lte(0)) {
    return { taxableAmount: net, taxAmount: new Decimal(0), lineTotal: net, components: [] };
  }

  if (!params.priceIncludesTax) {
    const { total, parts } = applySequence(net, inScope);
    return {
      taxableAmount: net,
      taxAmount: total,
      lineTotal: net.plus(total),
      components: parts.map(toComponent),
    };
  }

  // The price already contains the tax, so `net` is the tax-inclusive total.
  // Run the sequence against a unit base to obtain the multiplier it implies,
  // then divide back out. Division is inexact, so the components are recomputed
  // from the derived base and the residual is pushed onto the last component --
  // taxableAmount + sum(tax) then equals `net` exactly.
  const multiplier = new Decimal(1).plus(applySequence(new Decimal(1), inScope).total);
  if (multiplier.lte(0)) {
    throw new DomainError('VALIDATION_FAILED', 'Tax-inclusive pricing requires a positive combined rate', {}, 400);
  }

  const taxableAmount = net.div(multiplier);
  const { parts } = applySequence(taxableAmount, inScope);
  const components = parts.map(toComponent);

  const target = net.minus(taxableAmount);
  const summed = components.reduce((sum, component) => sum.plus(component.taxAmount), new Decimal(0));
  const residual = target.minus(summed);
  if (!residual.isZero()) {
    const last = components[components.length - 1];
    last.taxAmount = last.taxAmount.plus(residual);
  }

  return { taxableAmount, taxAmount: target, lineTotal: net, components };
}

function toComponent(part: { spec: TaxComponentSpec; taxableBase: Prisma.Decimal; taxAmount: Prisma.Decimal }): ComputedComponentTax {
  return {
    taxComponentId: part.spec.taxComponentId,
    componentCode: part.spec.componentCode,
    rate: new Decimal(part.spec.rate.toString()),
    taxableBase: part.taxableBase,
    taxAmount: part.taxAmount,
    outputAccountId: part.spec.outputAccountId,
    inputAccountId: part.spec.inputAccountId ?? null,
  };
}
