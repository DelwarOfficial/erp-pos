// A line discount must lie between zero and the line amount: a larger one
// would post a negative line (and could make a sale's total negative).
import { describe, expect, it } from 'vitest';
import { priceSaleItem } from '@/domain/tax/priceSaleItem';

const product = { defaultTaxCode: null } as never;
const asOf = new Date('2026-11-17T00:00:00Z');

describe('priceSaleItem discount bounds', () => {
  it('accepts a discount up to the full line amount', () => {
    expect(priceSaleItem(product, { qty: 2, unitPrice: 500, discountAmount: 1000 }, asOf).lineTotal.toFixed(2)).toBe('0.00');
    expect(priceSaleItem(product, { qty: 2, unitPrice: 500, discountAmount: 150 }, asOf).lineTotal.toFixed(2)).toBe('850.00');
  });

  it('refuses a discount above the line amount or below zero', () => {
    expect(() => priceSaleItem(product, { qty: 1, unitPrice: 500, discountAmount: 500.01 }, asOf)).toThrow(/between zero and the line amount/);
    expect(() => priceSaleItem(product, { qty: 1, unitPrice: 500, discountAmount: -1 }, asOf)).toThrow(/between zero and the line amount/);
  });
});
