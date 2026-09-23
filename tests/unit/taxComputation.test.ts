// F-22 / F-23 / F-24 regression: the tax settings the schema carries must
// actually affect what is charged.
//
//   priceIncludesTax        was never read -> inclusive prices were overcharged
//   compoundOnPrevious      was never applied -> stacked taxes under-collected
//   calculationOrder        was never applied -> order was arbitrary
//   effectiveFrom/To        was never filtered -> backdated documents used
//                           whatever rate was current
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { computeLineTax, applicableComponents, type TaxComponentSpec } from '@/domain/tax/computeLineTax';

const D = (value: string | number) => new Prisma.Decimal(value);

function component(overrides: Partial<TaxComponentSpec> & { componentCode: string; rate: string | number }): TaxComponentSpec {
  return {
    taxComponentId: `tc-${overrides.componentCode}`,
    calculationOrder: 1,
    compoundOnPrevious: false,
    effectiveFrom: new Date('2020-01-01'),
    effectiveTo: null,
    outputAccountId: `acct-${overrides.componentCode}`,
    ...overrides,
  } as TaxComponentSpec;
}

const ASOF = new Date('2026-06-15');

describe('exclusive pricing', () => {
  it('adds a single component on top of the net amount', () => {
    const result = computeLineTax({
      grossAmount: D(100), discountAmount: D(0), priceIncludesTax: false, asOf: ASOF,
      components: [component({ componentCode: 'VAT', rate: 15 })],
    });
    expect(result.taxableAmount.toFixed(2)).toBe('100.00');
    expect(result.taxAmount.toFixed(2)).toBe('15.00');
    expect(result.lineTotal.toFixed(2)).toBe('115.00');
  });

  it('charges a compound component on base plus earlier tax', () => {
    // SD 10% then VAT 15% on (base + SD): 10 + 16.50 = 26.50.
    // The previous flat implementation charged 10 + 15 = 25.00.
    const result = computeLineTax({
      grossAmount: D(100), discountAmount: D(0), priceIncludesTax: false, asOf: ASOF,
      components: [
        component({ componentCode: 'SD', rate: 10, calculationOrder: 1 }),
        component({ componentCode: 'VAT', rate: 15, calculationOrder: 2, compoundOnPrevious: true }),
      ],
    });
    expect(result.taxAmount.toFixed(2)).toBe('26.50');
    expect(result.components.map(c => [c.componentCode, c.taxAmount.toFixed(2)]))
      .toEqual([['SD', '10.00'], ['VAT', '16.50']]);
    // The compounded component sits on a larger base than the line's taxable amount.
    expect(result.components[1].taxableBase.toFixed(2)).toBe('110.00');
  });

  it('applies components in calculationOrder regardless of input order', () => {
    const ordered = computeLineTax({
      grossAmount: D(100), discountAmount: D(0), priceIncludesTax: false, asOf: ASOF,
      components: [
        component({ componentCode: 'VAT', rate: 15, calculationOrder: 2, compoundOnPrevious: true }),
        component({ componentCode: 'SD', rate: 10, calculationOrder: 1 }),
      ],
    });
    expect(ordered.components.map(c => c.componentCode)).toEqual(['SD', 'VAT']);
    expect(ordered.taxAmount.toFixed(2)).toBe('26.50');
  });

  it('taxes the amount net of discount', () => {
    const result = computeLineTax({
      grossAmount: D(100), discountAmount: D(20), priceIncludesTax: false, asOf: ASOF,
      components: [component({ componentCode: 'VAT', rate: 15 })],
    });
    expect(result.taxableAmount.toFixed(2)).toBe('80.00');
    expect(result.taxAmount.toFixed(2)).toBe('12.00');
  });
});

describe('inclusive pricing', () => {
  it('backs the tax out of the shelf price instead of adding to it', () => {
    // A 115.00 shelf price marked tax-inclusive at 15% contains 15.00 of VAT.
    // The previous implementation charged 115.00 + 17.25 = 132.25.
    const result = computeLineTax({
      grossAmount: D(115), discountAmount: D(0), priceIncludesTax: true, asOf: ASOF,
      components: [component({ componentCode: 'VAT', rate: 15 })],
    });
    expect(result.taxableAmount.toFixed(2)).toBe('100.00');
    expect(result.taxAmount.toFixed(2)).toBe('15.00');
    expect(result.lineTotal.toFixed(2)).toBe('115.00');
  });

  it('never charges the customer more than the shelf price', () => {
    for (const price of ['115.00', '99.99', '1234.56', '0.03']) {
      const result = computeLineTax({
        grossAmount: D(price), discountAmount: D(0), priceIncludesTax: true, asOf: ASOF,
        components: [
          component({ componentCode: 'SD', rate: 10, calculationOrder: 1 }),
          component({ componentCode: 'VAT', rate: 15, calculationOrder: 2, compoundOnPrevious: true }),
        ],
      });
      expect(result.lineTotal.toString()).toBe(D(price).toString());
      // Exact to the last digit: base + every component equals the price.
      const summed = result.components.reduce((s, c) => s.plus(c.taxAmount), result.taxableAmount);
      expect(summed.toString()).toBe(D(price).toString());
    }
  });
});

describe('effective dating', () => {
  const superseded = component({
    componentCode: 'VAT', rate: 10,
    effectiveFrom: new Date('2020-01-01'), effectiveTo: new Date('2026-07-01'),
  });
  const replacement = component({
    componentCode: 'VAT2', rate: 15,
    effectiveFrom: new Date('2026-07-01'), effectiveTo: null,
  });

  it('uses the rate in force on the document date, not today', () => {
    const june = computeLineTax({
      grossAmount: D(100), discountAmount: D(0), priceIncludesTax: false,
      asOf: new Date('2026-06-15'), components: [superseded, replacement],
    });
    expect(june.taxAmount.toFixed(2)).toBe('10.00');

    const july = computeLineTax({
      grossAmount: D(100), discountAmount: D(0), priceIncludesTax: false,
      asOf: new Date('2026-07-15'), components: [superseded, replacement],
    });
    expect(july.taxAmount.toFixed(2)).toBe('15.00');
  });

  it('excludes a component that has not started yet', () => {
    expect(applicableComponents([replacement], new Date('2026-01-01'))).toHaveLength(0);
  });

  it('treats effectiveTo as exclusive so the two never overlap', () => {
    const onBoundary = applicableComponents([superseded, replacement], new Date('2026-07-01'));
    expect(onBoundary.map(c => c.componentCode)).toEqual(['VAT2']);
  });
});

describe('edge cases', () => {
  it('charges nothing when no component is in force', () => {
    const result = computeLineTax({
      grossAmount: D(100), discountAmount: D(0), priceIncludesTax: false, asOf: ASOF, components: [],
    });
    expect(result.taxAmount.isZero()).toBe(true);
    expect(result.lineTotal.toFixed(2)).toBe('100.00');
  });

  it('rejects a discount larger than the line', () => {
    expect(() => computeLineTax({
      grossAmount: D(100), discountAmount: D(101), priceIncludesTax: false, asOf: ASOF,
      components: [component({ componentCode: 'VAT', rate: 15 })],
    })).toThrow(/Discount must be between zero/);
  });

  it('rejects a negative rate', () => {
    expect(() => computeLineTax({
      grossAmount: D(100), discountAmount: D(0), priceIncludesTax: false, asOf: ASOF,
      components: [component({ componentCode: 'VAT', rate: -5 })],
    })).toThrow(/invalid rate/);
  });
});
