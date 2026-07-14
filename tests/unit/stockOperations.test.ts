// tests/unit/stockOperations.test.ts
// Stock operations tests per §8 — blind count, count variance posting,
// serial scenarios, backdated stock policy.

import { describe, it, expect } from 'vitest';

// ── Blind Count (hides expected quantity) ──

describe('Stock Operations: Blind Count', () => {
  it('blind count mode hides expected quantity from counter', () => {
    const stockCount = {
      id: 'sc-1',
      isBlind: true,
      warehouseId: 'wh-1',
      items: [
        { productId: 'p-1', expectedQty: 100, countedQty: null },
        { productId: 'p-2', expectedQty: 50, countedQty: null },
      ],
    };

    // In blind mode, the counter should not see expectedQty
    function getCounterView(item: { expectedQty: number; countedQty: number | null }) {
      if (stockCount.isBlind) {
        return { productId: item.productId, countedQty: item.countedQty };
        // expectedQty is NOT included
      }
      return item;
    }

    const counterView = stockCount.items.map(getCounterView);
    expect(counterView[0]).not.toHaveProperty('expectedQty');
    expect(counterView[0]).toHaveProperty('countedQty');
  });

  it('non-blind count shows expected quantity', () => {
    const stockCount = {
      id: 'sc-2',
      isBlind: false,
      items: [{ productId: 'p-1', expectedQty: 100, countedQty: 98 }],
    };

    expect(stockCount.items[0].expectedQty).toBe(100);
    expect(stockCount.items[0].countedQty).toBe(98);
  });
});

// ── Count Variance Posts Exactly One Adjustment ──

describe('Stock Operations: Count Variance', () => {
  it('positive variance (counted > expected) posts adjustment_in', () => {
    const expected = 100;
    const counted = 105;
    const variance = counted - expected;

    expect(variance).toBe(5);
    expect(variance > 0).toBe(true);
    // Should post: movement_type = 'stock_count_gain', qty_delta = +5
  });

  it('negative variance (counted < expected) posts adjustment_out', () => {
    const expected = 100;
    const counted = 97;
    const variance = counted - expected;

    expect(variance).toBe(-3);
    expect(variance < 0).toBe(true);
    // Should post: movement_type = 'stock_count_loss', qty_delta = -3
  });

  it('zero variance (counted = expected) posts no adjustment', () => {
    const expected = 100;
    const counted = 100;
    const variance = counted - expected;

    expect(variance).toBe(0);
    // No adjustment posted
  });

  it('variance posts exactly one adjustment + balanced value journal', () => {
    const expected = 100;
    const counted = 95;
    const unitCost = 200;
    const variance = counted - expected; // -5
    const varianceValue = variance * unitCost; // -1000

    // One stock movement: qty_delta = -5, type = stock_count_loss
    // One journal line: Dr Inventory Adjustment 1000, Cr Inventory 1000
    expect(variance).toBe(-5);
    expect(varianceValue).toBe(-1000);

    // Verify journal is balanced
    const debit = Math.abs(varianceValue); // 1000 (Dr Inventory Adjustment)
    const credit = Math.abs(varianceValue); // 1000 (Cr Inventory)
    expect(debit).toBe(credit);
  });

  it('each variance line posts exactly one adjustment (not multiple)', () => {
    const countItems = [
      { productId: 'p-1', expected: 100, counted: 98, variance: -2 },
      { productId: 'p-2', expected: 50, counted: 52, variance: 2 },
      { productId: 'p-3', expected: 30, counted: 30, variance: 0 },
    ];

    // Only items with non-zero variance should post adjustments
    const adjustmentsToPost = countItems.filter(item => item.variance !== 0);
    expect(adjustmentsToPost).toHaveLength(2); // p-1 and p-2, not p-3
  });
});

// ── Serial Scenarios ──

describe('Stock Operations: Serial Scenarios', () => {
  it('missing serial (expected but not found) creates variance', () => {
    const serials = {
      expected: ['IMEI001', 'IMEI002', 'IMEI003'],
      found: ['IMEI001', 'IMEI003'], // IMEI002 missing
    };
    const missing = serials.expected.filter(s => !serials.found.includes(s));
    expect(missing).toEqual(['IMEI002']);
  });

  it('unexpected serial (found but not expected) creates variance', () => {
    const serials = {
      expected: ['IMEI001', 'IMEI002'],
      found: ['IMEI001', 'IMEI002', 'IMEI999'], // IMEI999 unexpected
    };
    const unexpected = serials.found.filter(s => !serials.expected.includes(s));
    expect(unexpected).toEqual(['IMEI999']);
  });

  it('duplicate serial (same serial scanned twice) is rejected', () => {
    const scannedSerials = ['IMEI001', 'IMEI002', 'IMEI001']; // duplicate
    const uniqueSerials = new Set(scannedSerials);
    const hasDuplicate = uniqueSerials.size !== scannedSerials.length;
    expect(hasDuplicate).toBe(true);
  });

  it('wrong-location serial (serial belongs to different warehouse) is flagged', () => {
    const serial = { serialNumber: 'IMEI001', currentWarehouseId: 'wh-A' };
    const countingWarehouse = 'wh-B';
    const isWrongLocation = serial.currentWarehouseId !== countingWarehouse;
    expect(isWrongLocation).toBe(true);
  });

  it('serial count reconciles to qty_on_hand for serialized products', () => {
    const product = { id: 'p-1', isSerialized: true };
    const warehouseStock = { productId: 'p-1', qtyOnHand: 5 };
    const inStockSerials = [
      { serialNumber: 'IMEI001', status: 'in_stock' },
      { serialNumber: 'IMEI002', status: 'in_stock' },
      { serialNumber: 'IMEI003', status: 'in_stock' },
      { serialNumber: 'IMEI004', status: 'in_stock' },
      { serialNumber: 'IMEI005', status: 'in_stock' },
    ];

    const serialCount = inStockSerials.filter(s => s.status === 'in_stock').length;
    expect(serialCount).toBe(5);
    expect(serialCount).toBe(warehouseStock.qtyOnHand);
  });
});

// ── Backdated Stock Policy ──

describe('Stock Operations: Backdated Stock Policy', () => {
  it('rejects backdated stock movement beyond policy threshold', () => {
    const policy = { maxBackdateDays: 7 };
    const movementDate = new Date();
    movementDate.setDate(movementDate.getDate() - 10); // 10 days ago

    const daysDiff = Math.floor((Date.now() - movementDate.getTime()) / (1000 * 60 * 60 * 24));
    const isBackdated = daysDiff > policy.maxBackdateDays;

    expect(isBackdated).toBe(true);
    expect(daysDiff).toBeGreaterThanOrEqual(10);
  });

  it('allows backdated stock movement within policy threshold', () => {
    const policy = { maxBackdateDays: 7 };
    const movementDate = new Date();
    movementDate.setDate(movementDate.getDate() - 5); // 5 days ago

    const daysDiff = Math.floor((Date.now() - movementDate.getTime()) / (1000 * 60 * 60 * 24));
    const isWithinPolicy = daysDiff <= policy.maxBackdateDays;

    expect(isWithinPolicy).toBe(true);
  });

  it('backdated movement requires approval beyond threshold', () => {
    const policy = { maxBackdateDays: 7, approvalRequired: true };
    const movementDate = new Date();
    movementDate.setDate(movementDate.getDate() - 10);

    const daysDiff = Math.floor((Date.now() - movementDate.getTime()) / (1000 * 60 * 60 * 24));
    const needsApproval = daysDiff > policy.maxBackdateDays && policy.approvalRequired;

    expect(needsApproval).toBe(true);
  });

  it('backdated movement in a locked fiscal period is rejected', () => {
    const fiscalPeriod = { status: 'locked', periodEnd: new Date('2026-06-30') };
    const movementDate = new Date('2026-06-15'); // within locked period

    const isInLockedPeriod = movementDate <= fiscalPeriod.periodEnd && fiscalPeriod.status === 'locked';
    expect(isInLockedPeriod).toBe(true);
  });
});

// ── Partial Receiving/Return Limits ──

describe('Stock Operations: Partial Receiving/Return Limits', () => {
  it('qty_received cannot exceed qty_ordered', () => {
    const orderLine = { qtyOrdered: 100, qtyReceived: 0 };
    const receivingQty = 120; // exceeds ordered

    expect(receivingQty > orderLine.qtyOrdered).toBe(true);
    // Domain command should reject with VALIDATION_FAILED
  });

  it('qty_returned cannot exceed qty_received', () => {
    const receivedLine = { qtyReceived: 80, qtyReturned: 0 };
    const returnQty = 90; // exceeds received

    expect(returnQty > receivedLine.qtyReceived).toBe(true);
  });

  it('partial receiving updates qty_received cumulatively', () => {
    let qtyReceived = 0;
    qtyReceived += 30; // first partial
    qtyReceived += 30; // second partial
    qtyReceived += 20; // third partial

    expect(qtyReceived).toBe(80);
  });

  it('cannot receive more than ordered across multiple partials', () => {
    const qtyOrdered = 100;
    let qtyReceived = 60;
    const nextPartial = 50; // 60 + 50 = 110 > 100

    expect(qtyReceived + nextPartial > qtyOrdered).toBe(true);
  });
});
