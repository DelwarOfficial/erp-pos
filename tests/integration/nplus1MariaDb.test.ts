import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  checkReservationProjection,
  checkSerialStockCount,
  checkStockQtyLedger,
  checkStockValueLedger,
} from '../../src/lib/reconciliation/checks';

const mariaDbDescribe = process.env.NPLUS1_MARIADB_TEST === '1' ? describe : describe.skip;

mariaDbDescribe('N+1 regression on disposable MariaDB 11.8', () => {
  const queries: string[] = [];
  const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const warehouseId = randomUUID();
  const otherWarehouseId = randomUUID();
  const categoryId = randomUUID();
  const otherCategoryId = randomUUID();
  const unitId = randomUUID();
  const otherUnitId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const eventId = randomUUID();
  const otherEventId = randomUUID();
  const productIds = Array.from({ length: 100 }, () => randomUUID());
  const otherProductId = randomUUID();

  db.$on('query', event => {
    if (/^\s*(SELECT|WITH)\b/i.test(event.query)) {
      queries.push(event.query.replace(/\s+/g, ' ').trim());
    }
  });

  beforeAll(async () => {
    await db.$connect();
    await db.company.createMany({ data: [
      { id: companyId, code: `N1-A-${Date.now()}`, legalName: 'N+1 Tenant A', displayName: 'N+1 A', baseCurrencyCode: 'BDT', status: 'active' },
      { id: otherCompanyId, code: `N1-B-${Date.now()}`, legalName: 'N+1 Tenant B', displayName: 'N+1 B', baseCurrencyCode: 'BDT', status: 'active' },
    ] });
    await db.branch.createMany({ data: [
      { id: branchId, companyId, name: 'Main', code: 'MAIN', isActive: true },
      { id: otherBranchId, companyId: otherCompanyId, name: 'Main', code: 'MAIN', isActive: true },
    ] });
    await db.warehouse.createMany({ data: [
      { id: warehouseId, companyId, branchId, name: 'Main', code: 'MAIN', warehouseType: 'retail' },
      { id: otherWarehouseId, companyId: otherCompanyId, branchId: otherBranchId, name: 'Main', code: 'MAIN', warehouseType: 'retail' },
    ] });
    await db.category.createMany({ data: [
      { id: categoryId, companyId, name: 'Category', code: 'CAT', isActive: true },
      { id: otherCategoryId, companyId: otherCompanyId, name: 'Category', code: 'CAT', isActive: true },
    ] });
    await db.unit.createMany({ data: [
      { id: unitId, companyId, name: 'Each', code: 'EA', conversionFactor: 1, allowFractional: false },
      { id: otherUnitId, companyId: otherCompanyId, name: 'Each', code: 'EA', conversionFactor: 1, allowFractional: false },
    ] });
    await db.user.createMany({ data: [
      { id: userId, companyId, name: 'Auditor', email: `${userId}@test.local`, passwordHash: 'not-a-credential', accessScope: 'global' },
      { id: otherUserId, companyId: otherCompanyId, name: 'Auditor', email: `${otherUserId}@test.local`, passwordHash: 'not-a-credential', accessScope: 'global' },
    ] });
    await db.product.createMany({ data: [
      ...productIds.map((id, i) => ({ id, companyId, name: `Product ${i}`, code: `P-${i}`, categoryId, unitId, isSerialized: true })),
      { id: otherProductId, companyId: otherCompanyId, name: 'Other product', code: 'OTHER', categoryId: otherCategoryId, unitId: otherUnitId, isSerialized: true },
    ] });
    await db.businessEvent.createMany({ data: [
      { id: eventId, companyId, eventType: 'opening_stock', sourceType: 'nplus1_test', sourceId: eventId, correlationId: 'nplus1-test' },
      { id: otherEventId, companyId: otherCompanyId, eventType: 'opening_stock', sourceType: 'nplus1_test', sourceId: otherEventId, correlationId: 'nplus1-test' },
    ] });
    await db.warehouseStock.createMany({ data: [
      ...productIds.map(productId => ({ companyId, warehouseId, productId, qtyOnHand: 1, qtyReserved: 1, movingAverageCost: 10 })),
      { companyId: otherCompanyId, warehouseId: otherWarehouseId, productId: otherProductId, qtyOnHand: 99, qtyReserved: 99, movingAverageCost: 99 },
    ] });
    await db.stockMovement.createMany({ data: [
      ...productIds.map((productId, i) => ({ id: randomUUID(), companyId, eventId, eventLineNo: i + 1, warehouseId, productId, movementType: 'opening_stock', qtyDelta: 1, unitCost: 10, totalCostDelta: 10, referenceType: 'test', referenceId: productId, effectiveAt: new Date(), createdBy: userId })),
      { id: randomUUID(), companyId: otherCompanyId, eventId: otherEventId, eventLineNo: 1, warehouseId: otherWarehouseId, productId: otherProductId, movementType: 'opening_stock', qtyDelta: 1, unitCost: 1, totalCostDelta: 1, referenceType: 'test', referenceId: otherProductId, effectiveAt: new Date(), createdBy: otherUserId },
    ] });
    await db.stockReservation.createMany({ data: [
      ...productIds.map(productId => ({ id: randomUUID(), companyId, warehouseId, productId, reservationType: 'sale', referenceId: productId, qty: 1, status: 'active' })),
      { id: randomUUID(), companyId: otherCompanyId, warehouseId: otherWarehouseId, productId: otherProductId, reservationType: 'sale', referenceId: otherProductId, qty: 1, status: 'active' },
    ] });
    await db.productSerial.createMany({ data: [
      ...productIds.map((productId, i) => ({ id: randomUUID(), companyId, productId, serialNumber: `N1-A-${i}`, status: 'in_stock', currentWarehouseId: warehouseId })),
      { id: randomUUID(), companyId: otherCompanyId, productId: otherProductId, serialNumber: 'N1-B-0', status: 'in_stock', currentWarehouseId: otherWarehouseId },
    ] });
  }, 60_000);

  afterAll(async () => {
    await db.$disconnect();
  });

  for (const [name, check] of [
    ['stock quantity', checkStockQtyLedger],
    ['stock value', checkStockValueLedger],
    ['serial count', checkSerialStockCount],
    ['reservation projection', checkReservationProjection],
  ] as const) {
    it(`${name} uses two reads for 100 rows and excludes Tenant B`, async () => {
      queries.length = 0;
      const findings = await db.$transaction(tx => check(tx, companyId));
      expect(queries).toHaveLength(2);
      expect(findings).toEqual([]);
      expect(queries.every(query => query.includes('?'))).toBe(true);
    });
  }

  it('completes 100 concurrent tenant-scoped reconciliation reads without leakage', async () => {
    const results = await Promise.all(Array.from({ length: 100 }, () =>
      db.$transaction(tx => checkStockQtyLedger(tx, companyId)),
    ));
    expect(results).toHaveLength(100);
    expect(results.every(findings => findings.length === 0)).toBe(true);
  }, 60_000);
});
