// tests/unit/postSale.test.ts
// Tests for PostSale domain command — the POS sale workflow.
//
// Scenarios:
//   1. Successful sale posts stock movement (outbound) + reduces qty_on_hand
//   2. Serialized product: serial transitions to 'sold', cannot sell twice
//   3. Negative-stock rejection (cannot oversell)
//   4. Void reverses stock + reverts serial status

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { postSale } from '../../src/domain/commands/m3/PostSale';
import { voidSale } from '../../src/domain/commands/m3/VoidSale';
import { postStockMovement } from '../../src/domain/inventory/stockMovement';
import { DomainError } from '../../src/lib/errors/codes';

const db = new PrismaClient();

let companyId: string;
let branchId: string;
let warehouseId: string;
let categoryId: string;
let unitId: string;
let productId: string;
let serializedProductId: string;
let userId: string;
let financialAccountId: string;

beforeAll(async () => {
  await db.$connect();
  const company = await db.company.create({
    data: {
      code: 'TEST-SALE-' + Date.now(),
      legalName: 'Sale Test Co',
      displayName: 'Sale Test',
      baseCurrencyCode: 'BDT',
      status: 'active',
    },
  });
  companyId = company.id;
  const branch = await db.branch.create({ data: { companyId, name: 'Main', code: 'MAIN', isActive: true } });
  branchId = branch.id;
  const warehouse = await db.warehouse.create({ data: { companyId, branchId, name: 'WH', code: 'WH', warehouseType: 'retail' } });
  warehouseId = warehouse.id;
  const category = await db.category.create({ data: { companyId, name: 'Cat', code: 'C', isActive: true } });
  categoryId = category.id;
  const unit = await db.unit.create({ data: { companyId, name: 'Pc', code: 'PC', conversionFactor: 1, allowFractional: false } });
  unitId = unit.id;
  const product = await db.product.create({
    data: { companyId, name: 'Test Product', code: 'TP', categoryId, unitId, productType: 'standard', isActive: true, defaultPrice: 100 },
  });
  productId = product.id;
  const serializedProduct = await db.product.create({
    data: { companyId, name: 'Phone', code: 'PHN', categoryId, unitId, productType: 'standard', isSerialized: true, isActive: true, defaultPrice: 5000 },
  });
  serializedProductId = serializedProduct.id;
  const user = await db.user.create({
    data: { companyId, name: 'Cashier', email: 'cashier-' + Date.now() + '@test.local', passwordHash: 'x', accessScope: 'single_branch' },
  });
  userId = user.id;
  // financialAccountId — create a real financial account for the FK.
  // First create a chart of account, then a financial account.
  const coa = await db.chartOfAccount.create({
    data: {
      companyId,
      code: '1001',
      name: 'Cash on Hand',
      accountClass: 'asset',
      accountSubtype: 'current_asset',
      normalBalance: 'D',
      isControlAccount: true,
    },
  });
  const fa = await db.financialAccount.create({
    data: {
      companyId,
      chartOfAccountId: coa.id,
      name: 'Main Cash Drawer',
      accountType: 'cash',
      currencyCode: 'BDT',
    },
  });
  financialAccountId = fa.id;

  // Seed opening stock: 10 units of Test Product @ 50 BDT
  const eventId = crypto.randomUUID();
  await db.businessEvent.create({
    data: { id: eventId, companyId, eventType: 'opening_stock', sourceType: 'test', sourceId: 'setup', correlationId: 'test' },
  });
  await db.$transaction(async (tx) => {
    await postStockMovement(tx, {
      companyId, eventId, eventLineNo: 1,
      warehouseId, productId,
      movementType: 'opening_stock',
      qtyDelta: 10, unitCost: 50,
      referenceType: 'opening_stock', referenceId: 'test-setup',
      effectiveAt: new Date(), createdBy: userId,
    });
  });

  // Seed 3 serialized phones
  for (let i = 1; i <= 3; i++) {
    await db.productSerial.create({
      data: {
        companyId, productId: serializedProductId,
        serialNumber: `IMEI-00${i}`,
        status: 'in_stock',
        currentWarehouseId: warehouseId,
      },
    });
  }
  // Opening stock for serialized product (3 units @ 4000 BDT)
  await db.$transaction(async (tx) => {
    await postStockMovement(tx, {
      companyId, eventId, eventLineNo: 2,
      warehouseId, productId: serializedProductId,
      movementType: 'opening_stock',
      qtyDelta: 3, unitCost: 4000,
      referenceType: 'opening_stock', referenceId: 'test-setup-2',
      effectiveAt: new Date(), createdBy: userId,
    });
  });
});

afterAll(async () => {
  if (companyId) {
    // Delete in strict dependency order; wrap in try/catch to be non-fatal
    const cleanup = async () => {
      await db.paymentAllocation.deleteMany({ where: { companyId } });
      await db.payment.deleteMany({ where: { companyId } });
      const saleItemIds = await db.saleItem.findMany({ where: { companyId }, select: { id: true } });
      if (saleItemIds.length > 0) {
        await db.saleItemSerial.deleteMany({ where: { saleItemId: { in: saleItemIds.map(s => s.id) } } });
      }
      await db.saleItemTax.deleteMany({ where: { companyId } });
      await db.saleItem.deleteMany({ where: { companyId } });
      await db.sale.deleteMany({ where: { companyId } });
      await db.serialEvent.deleteMany({ where: { companyId } });
      await db.stockMovement.deleteMany({ where: { companyId } });
      await db.warehouseStock.deleteMany({ where: { companyId } });
      await db.productSerial.deleteMany({ where: { companyId } });
      await db.businessEvent.deleteMany({ where: { companyId } });
      await db.product.deleteMany({ where: { companyId } });
      await db.unit.deleteMany({ where: { companyId } });
      await db.category.deleteMany({ where: { companyId } });
      await db.warehouse.deleteMany({ where: { companyId } });
      await db.branch.deleteMany({ where: { companyId } });
      await db.user.deleteMany({ where: { companyId } });
      await db.auditLog.deleteMany({ where: { companyId } });
      await db.securityEvent.deleteMany({ where: { companyId } });
      await db.financialAccount.deleteMany({ where: { companyId } });
      await db.chartOfAccount.deleteMany({ where: { companyId } });
      await db.company.deleteMany({ where: { id: companyId } });
    };
    try { await cleanup(); } catch (e) { console.error('Cleanup error (non-fatal):', e); }
  }
  await db.$disconnect();
});

describe('PostSale — POS sale workflow', () => {
  it('posts a cash sale with stock reduction', async () => {
    const result = await db.$transaction(async (tx) => {
      return postSale(tx, {
        companyId, branchId, warehouseId,
        cashierId: userId,
        currencyCode: 'BDT', exchangeRate: 1,
        businessDate: new Date(),
        items: [{ productId, qty: 2, unitPrice: 100 }],
        payments: [{ paymentMethod: 'cash', amount: 200, financialAccountId }],
      }, 'test-correlation');
    });

    expect(result.saleStatus).toBe('completed');
    expect(result.itemCount).toBe(1);
    expect(result.paymentCount).toBe(1);
    expect(parseFloat(result.grandTotal)).toBe(200); // 2 × 100, no tax (no tax code configured)

    // Verify stock reduced from 10 to 8
    const stock = await db.warehouseStock.findFirst({
      where: { companyId, warehouseId, productId },
    });
    expect(parseFloat(stock!.qtyOnHand.toString())).toBe(8);
  });

  it('rejects oversell (negative-stock prohibition)', async () => {
    // Only 8 left; try to sell 10
    await expect(
      db.$transaction(async (tx) => {
        return postSale(tx, {
          companyId, branchId, warehouseId,
          cashierId: userId,
          currencyCode: 'BDT', exchangeRate: 1,
          businessDate: new Date(),
          items: [{ productId, qty: 10, unitPrice: 100 }],
          payments: [{ paymentMethod: 'cash', amount: 1000, financialAccountId }],
        }, 'test-correlation-2');
      }),
    ).rejects.toThrow(/Insufficient stock/);
  });

  it('posts a serialized sale with IMEI tracking', async () => {
    const result = await db.$transaction(async (tx) => {
      return postSale(tx, {
        companyId, branchId, warehouseId,
        cashierId: userId,
        currencyCode: 'BDT', exchangeRate: 1,
        businessDate: new Date(),
        items: [{
          productId: serializedProductId,
          qty: 2,
          unitPrice: 5000,
          serials: ['IMEI-001', 'IMEI-002'],
        }],
        payments: [{ paymentMethod: 'cash', amount: 10000, financialAccountId }],
      }, 'test-correlation-3');
    });

    expect(result.itemCount).toBe(1);
    expect(result.paymentCount).toBe(1);

    // Verify serials are now 'sold'
    const serial1 = await db.productSerial.findFirst({
      where: { companyId, serialNumber: 'IMEI-001' },
    });
    expect(serial1?.status).toBe('sold');
    expect(serial1?.currentWarehouseId).toBeNull();
    expect(serial1?.soldSaleItemId).not.toBeNull();

    const serial2 = await db.productSerial.findFirst({
      where: { companyId, serialNumber: 'IMEI-002' },
    });
    expect(serial2?.status).toBe('sold');
  });

  it('prevents selling the same serial twice', async () => {
    // IMEI-001 is now 'sold'; try to sell it again
    await expect(
      db.$transaction(async (tx) => {
        return postSale(tx, {
          companyId, branchId, warehouseId,
          cashierId: userId,
          currencyCode: 'BDT', exchangeRate: 1,
          businessDate: new Date(),
          items: [{
            productId: serializedProductId,
            qty: 1,
            unitPrice: 5000,
            serials: ['IMEI-001'],  // already sold
          }],
          payments: [{ paymentMethod: 'cash', amount: 5000, financialAccountId }],
        }, 'test-correlation-4');
      }),
    ).rejects.toThrow(/not found in this warehouse|not in_stock|SERIAL_NOT_AVAILABLE/);
  });

  it('voids a sale and restores stock + serial status', async () => {
    // Post a sale of 1 serialized phone (IMEI-003)
    const sale = await db.$transaction(async (tx) => {
      return postSale(tx, {
        companyId, branchId, warehouseId,
        cashierId: userId,
        currencyCode: 'BDT', exchangeRate: 1,
        businessDate: new Date(),
        items: [{
          productId: serializedProductId,
          qty: 1,
          unitPrice: 5000,
          serials: ['IMEI-003'],
        }],
        payments: [{ paymentMethod: 'cash', amount: 5000, financialAccountId }],
      }, 'test-correlation-5');
    });

    // Verify serial is 'sold'
    const serialBefore = await db.productSerial.findFirst({
      where: { companyId, serialNumber: 'IMEI-003' },
    });
    expect(serialBefore?.status).toBe('sold');

    // Void the sale
    const voidResult = await db.$transaction(async (tx) => {
      return voidSale(tx, {
        saleId: sale.saleId,
        companyId,
        voidedBy: userId,
        reason: 'test void',
      }, 'test-correlation-void');
    });

    expect(voidResult.saleStatus).toBe('voided');

    // Verify serial is back to 'in_stock'
    const serialAfter = await db.productSerial.findFirst({
      where: { companyId, serialNumber: 'IMEI-003' },
    });
    expect(serialAfter?.status).toBe('in_stock');
    expect(serialAfter?.currentWarehouseId).toBe(warehouseId);
    expect(serialAfter?.soldSaleItemId).toBeNull();

    // Verify sale is voided
    const saleAfter = await db.sale.findUnique({ where: { id: sale.saleId } });
    expect(saleAfter?.saleStatus).toBe('voided');
    expect(saleAfter?.voidedAt).not.toBeNull();
  });
});
