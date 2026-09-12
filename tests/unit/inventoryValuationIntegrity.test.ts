import { describe, expect, it } from 'vitest';
import { projectStockValue } from '@/domain/inventory/valuation';

describe('historical-cost stock reversal valuation', () => {
  it('voids 5 at 100 after remaining 5 at 100 and receipt 5 at 200', () => {
    const result = projectStockValue({ quantity: '10', averageCost: '150', quantityDelta: '5', movementUnitCost: '100' });
    expect(result.quantity).toBe('15');
    expect(result.valueDelta).toBe('500');
    expect(result.averageCost).toBe('133.333333333333333333333333333333');
  });
  it('removes historical receipt value, not the current average value', () => {
    const result = projectStockValue({ quantity: '10', averageCost: '150', quantityDelta: '-5', movementUnitCost: '200' });
    expect(result).toEqual({ quantity: '5', averageCost: '100', valueDelta: '-1000' });
  });
  it('preserves decimal fractional quantity and costs without binary floats', () => {
    expect(projectStockValue({ quantity: '0.1', averageCost: '0.2', quantityDelta: '0.2', movementUnitCost: '0.2' }))
      .toEqual({ quantity: '0.3', averageCost: '0.2', valueDelta: '0.04' });
  });
  it('rejects a reversal that would silently discard remaining value at zero quantity', () => {
    expect(() => projectStockValue({ quantity: '5', averageCost: '150', quantityDelta: '-5', movementUnitCost: '100' }))
      .toThrow(/explicit inventory valuation adjustment/);
  });
  it('rejects a reversal that would leave negative inventory value', () => {
    expect(() => projectStockValue({ quantity: '10', averageCost: '50', quantityDelta: '-5', movementUnitCost: '200' })).toThrow();
  });
  it('rejects overselling', () => {
    expect(() => projectStockValue({ quantity: '1', averageCost: '100', quantityDelta: '-2', movementUnitCost: '100' })).toThrow();
  });
});
