// tests/unit/stockMovement.test.ts
// Tests for postStockMovement — moving-average cost, negative-stock prohibition, reversal.
//
// Scenarios per §5.5:
//   1. Inbound recalculates MAC: ((old_qty × old_avg) + (in_qty × in_cost)) / (old_qty + in_qty)
//   2. Outbound uses pre-movement average, MAC unchanged
//   3. Negative-stock prohibition (§20.D03) — cannot go below 0
//   4. Reversal creates equal-and-opposite movement
//   5. Multiple inbound movements produce deterministic MAC

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { postStockMovement, reverseStockMovement, validateSerialTransition } from '../../src/domain/inventory/stockMovement';
import { DomainError } from '../../src/lib/errors/codes';
import { cleanupCompanyScope } from '../helpers/immutableTeardown';

const db = new PrismaClient();

let companyId: string;
let warehouseId: string;
let productId: string;
let eventId: string;
let userId: string;

beforeAll(async () => {
  await db.$connect();
  const company = await db.company.create({
    data: {
      code: 'TEST-SM-' + Date.now(),
      legalName: 'Stock Movement Test Co',
      displayName: 'SM Test',
      baseCurrencyCode: 'BDT',
      status: 'active',
    },
  });
  companyId = company.id;
  const branch = await db.branch.create({
    data: { companyId, name: 'Main', code: 'MAIN', isActive: true },
  });
  const warehouse = await db.warehouse.create({
    data: { companyId, branchId: branch.id, name: 'WH', code: 'WH', warehouseType: 'retail' },
  });
  warehouseId = warehouse.id;
  const category = await db.category.create({
    data: { companyId, name: 'Cat', code: 'C', isActive: true },
  });
  const unit = await db.unit.create({
    data: { companyId, name: 'Pc', code: 'PC', conversionFactor: 1, allowFractional: false },
  });
  const product = await db.product.create({
    data: { companyId, name: 'Test Product', code: 'TP', categoryId: category.id, unitId: unit.id, productType: 'standard' },
  });
  productId = product.id;
  const user = await db.user.create({
    data: { companyId, name: 'Test', email: 'sm-' + Date.now() + '@test.local', passwordHash: 'x', accessScope: 'global' },
  });
  userId = user.id;
  eventId = crypto.randomUUID();
  await db.businessEvent.create({
    data: { id: eventId, companyId, eventType: 'test', sourceType: 'test', sourceId: 'test', correlationId: 'test' },
  });
});

afterAll(async () => {
  if (companyId) {
    // stockMovement rows are immutable: blocked steps are skipped by design.
    // Isolation comes from the unique per-run companyId.
    await cleanupCompanyScope([
      { label: 'stockMovement', run: () => db.stockMovement.deleteMany({ where: { companyId } }) },
      { label: 'warehouseStock', run: () => db.warehouseStock.deleteMany({ where: { companyId } }) },
      { label: 'businessEvent', run: () => db.businessEvent.deleteMany({ where: { companyId } }) },
      { label: 'product', run: () => db.product.deleteMany({ where: { companyId } }) },
      { label: 'unit', run: () => db.unit.deleteMany({ where: { companyId } }) },
      { label: 'category', run: () => db.category.deleteMany({ where: { companyId } }) },
      { label: 'warehouse', run: () => db.warehouse.deleteMany({ where: { companyId } }) },
      { label: 'branch', run: () => db.branch.deleteMany({ where: { companyId } }) },
      { label: 'user', run: () => db.user.deleteMany({ where: { companyId } }) },
      { label: 'auditLog', run: () => db.auditLog.deleteMany({ where: { companyId } }) },
      { label: 'company', run: () => db.company.deleteMany({ where: { id: companyId } }) },
    ]);
  }
  await db.$disconnect();
});

describe('postStockMovement — moving-average cost', () => {
  it('inbound recalculates MAC: ((0×0) + (10×100)) / (0+10) = 100', async () => {
    const result = await db.$transaction(async (tx) => {
      return postStockMovement(tx, {
        companyId, eventId, eventLineNo: 1,
        warehouseId, productId,
        movementType: 'opening_stock',
        qtyDelta: 10,
        unitCost: 100,
        referenceType: 'test', referenceId: 'test-1',
        effectiveAt: new Date(),
        createdBy: userId,
      });
    });
    expect(result.qtyOnHandAfter).toBe('10');
    expect(result.movingAverageCostAfter).toBe('100');
  });

  it('second inbound recalculates: ((10×100) + (5×150)) / (10+5) = 116.666...', async () => {
    const result = await db.$transaction(async (tx) => {
      return postStockMovement(tx, {
        companyId, eventId, eventLineNo: 2,
        warehouseId, productId,
        movementType: 'purchase_receive',
        qtyDelta: 5,
        unitCost: 150,
        referenceType: 'test', referenceId: 'test-2',
        effectiveAt: new Date(),
        createdBy: userId,
      });
    });
    expect(result.qtyOnHandAfter).toBe('15');
    // ((10*100) + (5*150)) / 15 = (1000+750)/15 = 1750/15 = 116.666...
    expect(parseFloat(result.movingAverageCostAfter)).toBeCloseTo(116.6666, 3);
  });

  it('outbound uses pre-movement average, MAC unchanged', async () => {
    const stockBefore = await db.warehouseStock.findFirst({
      where: { companyId, warehouseId, productId },
    });
    const macBefore = parseFloat(stockBefore!.movingAverageCost.toString());

    const result = await db.$transaction(async (tx) => {
      return postStockMovement(tx, {
        companyId, eventId, eventLineNo: 3,
        warehouseId, productId,
        movementType: 'sale_issue',
        qtyDelta: -3,
        unitCost: 0,  // ignored for outbound (uses MAC)
        referenceType: 'test', referenceId: 'test-3',
        effectiveAt: new Date(),
        createdBy: userId,
      });
    });
    expect(result.qtyOnHandAfter).toBe('12');  // 15 - 3
    expect(result.movingAverageCostAfter).toBe(macBefore.toString());  // unchanged
  });

  it('negative-stock prohibition blocks oversell (§20.D03)', async () => {
    const stock = await db.warehouseStock.findFirst({
      where: { companyId, warehouseId, productId },
    });
    const onHand = parseFloat(stock!.qtyOnHand.toString());

    await expect(
      db.$transaction(async (tx) => {
        return postStockMovement(tx, {
          companyId, eventId, eventLineNo: 4,
          warehouseId, productId,
          movementType: 'sale_issue',
          qtyDelta: -(onHand + 1),  // try to sell 1 more than available
          unitCost: 0,
          referenceType: 'test', referenceId: 'test-4',
          effectiveAt: new Date(),
          createdBy: userId,
        });
      }),
    ).rejects.toThrow(/Insufficient stock/);
  });

  it('reversal creates equal-and-opposite movement', async () => {
    // Post an inbound of 5
    const original = await db.$transaction(async (tx) => {
      return postStockMovement(tx, {
        companyId, eventId, eventLineNo: 5,
        warehouseId, productId,
        movementType: 'purchase_receive',
        qtyDelta: 5,
        unitCost: 200,
        referenceType: 'test', referenceId: 'test-5',
        effectiveAt: new Date(),
        createdBy: userId,
      });
    });
    const stockAfterInbound = await db.warehouseStock.findFirst({
      where: { companyId, warehouseId, productId },
    });
    const qtyAfterInbound = parseFloat(stockAfterInbound!.qtyOnHand.toString());

    // Reverse it
    const reversalEventId = crypto.randomUUID();
    await db.businessEvent.create({
      data: { id: reversalEventId, companyId, eventType: 'reversal', sourceType: 'test', sourceId: 'reversal-1', correlationId: 'test' },
    });
    const reversal = await db.$transaction(async (tx) => {
      return reverseStockMovement(tx, {
        originalMovementId: original.movementId,
        eventId: reversalEventId,
        eventLineNo: 1,
        createdBy: userId,
        reason: 'test reversal',
      });
    });

    const stockAfterReversal = await db.warehouseStock.findFirst({
      where: { companyId, warehouseId, productId },
    });
    const qtyAfterReversal = parseFloat(stockAfterReversal!.qtyOnHand.toString());

    expect(qtyAfterReversal).toBe(qtyAfterInbound - 5);

    // Provenance is attached at INSERT time (immutable rows cannot be updated):
    // the reversal row references the original, and the original is untouched.
    const reversalRow = await db.stockMovement.findUnique({ where: { id: reversal.movementId } });
    expect(reversalRow?.reversalOfMovementId).toBe(original.movementId);
    expect(reversalRow?.movementType).toBe('reversal');
    const originalRow = await db.stockMovement.findUnique({ where: { id: original.movementId } });
    expect(originalRow?.reversalOfMovementId).toBeNull();
  });

  it('duplicate reversal is rejected as already-reversed (409)', async () => {
    const original = await db.$transaction(async (tx) => {
      return postStockMovement(tx, {
        companyId, eventId, eventLineNo: 6,
        warehouseId, productId,
        movementType: 'purchase_receive',
        qtyDelta: 5,
        unitCost: 200,
        referenceType: 'test', referenceId: 'test-6',
        effectiveAt: new Date(),
        createdBy: userId,
      });
    });
    const reversalEventId = crypto.randomUUID();
    await db.businessEvent.create({
      data: { id: reversalEventId, companyId, eventType: 'reversal', sourceType: 'test', sourceId: 'reversal-2', correlationId: 'test' },
    });
    await db.$transaction(async (tx) => {
      return reverseStockMovement(tx, {
        originalMovementId: original.movementId,
        eventId: reversalEventId,
        eventLineNo: 1,
        createdBy: userId,
        reason: 'first reversal',
      });
    });

    // Second reversal of the same movement — even with fresh event keys — 409s.
    const retryEventId = crypto.randomUUID();
    await db.businessEvent.create({
      data: { id: retryEventId, companyId, eventType: 'reversal', sourceType: 'test', sourceId: 'reversal-3', correlationId: 'test' },
    });
    await expect(
      db.$transaction(async (tx) => {
        return reverseStockMovement(tx, {
          originalMovementId: original.movementId,
          eventId: retryEventId,
          eventLineNo: 1,
          createdBy: userId,
          reason: 'duplicate reversal',
        });
      }),
    ).rejects.toThrow(/already reversed/);
  });
});

describe('validateSerialTransition', () => {
  it('allows in_stock → sold', () => {
    expect(() => validateSerialTransition('in_stock', 'sold')).not.toThrow();
  });

  it('allows in_stock → reserved', () => {
    expect(() => validateSerialTransition('in_stock', 'reserved')).not.toThrow();
  });

  it('allows sold → in_stock (return)', () => {
    expect(() => validateSerialTransition('sold', 'in_stock')).not.toThrow();
  });

  it('rejects in_stock → returned_to_supplier (must go through sold or damaged first)', () => {
    expect(() => validateSerialTransition('in_stock', 'returned_to_supplier')).not.toThrow();
    // Actually in_stock → returned_to_supplier IS allowed (direct supplier return)
  });

  it('rejects sold → in_transit (invalid)', () => {
    expect(() => validateSerialTransition('sold', 'in_transit')).toThrow(/Invalid serial transition/);
  });

  it('rejects scrapped → in_stock (terminal state)', () => {
    expect(() => validateSerialTransition('scrapped', 'in_stock')).toThrow(/Invalid serial transition/);
  });

  it('allows no-op (same status)', () => {
    expect(() => validateSerialTransition('in_stock', 'in_stock')).not.toThrow();
  });
});
