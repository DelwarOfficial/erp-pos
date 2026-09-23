// F-19 / F-20 / F-21 regression: money and stock movements must reach the
// general ledger.
//
// Eleven write paths bypassed postJournalEntry entirely. These three were the
// most damaging, and each is asserted here against a real MariaDB transaction
// that is rolled back afterwards:
//
//   F-19  receiving a purchase posted stock and no journal, while sales and
//         purchase returns both CREDIT the inventory account -- so inventory
//         was only ever credited and drifted permanently negative
//   F-20  voiding a sale reversed stock, serials and payments and left
//         revenue, output tax and COGS on the books for ever
//   F-21  a sale return restocked goods and credited the customer with no GL
//         posting of any kind
import { afterAll, beforeAll, expect, describe, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { receivePurchase } from '@/domain/commands/m2/ReceivePurchase';
import { postSale } from '@/domain/commands/m3/PostSale';
import { voidSale } from '@/domain/commands/m3/VoidSale';
import { postSaleReturn } from '@/domain/commands/m3/PostSaleReturn';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const COMPANY_ID = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ROLLBACK = new Error('ROLLBACK_GL_COVERAGE_PROBE');

let fixture: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let inventoryAccountId: string;
let revenueAccountId: string;
let cogsAccountId: string;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318'
    || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fixture = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'GL', code: 'SYN-GL' });
  const policy = await db.accountingPolicy.findUniqueOrThrow({ where: { companyId: COMPANY_ID } });
  inventoryAccountId = policy.inventoryAccountId;
  revenueAccountId = policy.salesRevenueAccountId;
  cogsAccountId = policy.cogsAccountId;
});

afterAll(() => db.$disconnect());

/** Net movement on one account across every posted or reversed entry for a source document. */
async function netMovement(
  tx: Prisma.TransactionClient,
  accountId: string,
  sourceType: string,
  sourceIds: string[],
): Promise<Prisma.Decimal> {
  const totals = await tx.journalLine.aggregate({
    where: {
      companyId: COMPANY_ID,
      chartOfAccountId: accountId,
      journalEntry: { companyId: COMPANY_ID, sourceType, sourceId: { in: sourceIds }, status: { in: ['posted', 'reversed'] } },
    },
    _sum: { debitBase: true, creditBase: true },
  });
  return new Prisma.Decimal(totals._sum.debitBase ?? 0).minus(totals._sum.creditBase ?? 0);
}

/** Runs the body against a real transaction and always rolls it back. */
async function probe(body: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  try {
    await db.$transaction(async tx => {
      await body(tx);
      throw ROLLBACK;
    }, { timeout: 30000 });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

async function makeProduct(tx: Prisma.TransactionClient) {
  let unit = await tx.unit.findFirst({ where: { companyId: COMPANY_ID } });
  if (!unit) unit = await tx.unit.create({ data: { companyId: COMPANY_ID, code: 'pc', name: 'Piece' } });
  let category = await tx.category.findFirst({ where: { companyId: COMPANY_ID } });
  if (!category) category = await tx.category.create({ data: { companyId: COMPANY_ID, code: 'gen', name: 'General' } });
  return tx.product.create({
    data: {
      companyId: COMPANY_ID, code: `GL-${randomUUID().slice(0, 8)}`, name: 'GL probe product',
      productType: 'standard', unitId: unit.id, categoryId: category.id,
      defaultPrice: 100, referenceCost: 60, isActive: true,
    },
  });
}

async function makeWarehouse(tx: Prisma.TransactionClient) {
  const branch = fixture.branches[0];
  let warehouse = await tx.warehouse.findFirst({ where: { companyId: COMPANY_ID, branchId: branch.id } });
  if (!warehouse) {
    warehouse = await tx.warehouse.create({
      data: { companyId: COMPANY_ID, branchId: branch.id, code: 'WH-GL', name: 'GL probe warehouse', isActive: true },
    });
  }
  return warehouse;
}

describe('every money and stock movement reaches the general ledger', () => {
  it('F-19: receiving a purchase DEBITS inventory', async () => {
    await probe(async tx => {
      const warehouse = await makeWarehouse(tx);
      const product = await makeProduct(tx);
      let supplier = await tx.supplier.findFirst({ where: { companyId: COMPANY_ID } });
      if (!supplier) supplier = await tx.supplier.create({ data: { companyId: COMPANY_ID, name: 'GL supplier' } });

      const purchase = await tx.purchase.create({
        data: {
          companyId: COMPANY_ID, branchId: warehouse.branchId, warehouseId: warehouse.id,
          supplierId: supplier.id, referenceNo: `PO-${randomUUID().slice(0, 8)}`,
          orderStatus: 'ordered', orderDate: new Date(), currencyCode: 'BDT', exchangeRate: 1,
          subtotal: 600, taxTotal: 0, grandTotal: 600, baseGrandTotal: 600, createdBy: fixture.user.id,
          items: { create: [{ companyId: COMPANY_ID, lineNo: 1, productId: product.id,
            productNameSnapshot: product.name, productCodeSnapshot: product.code,
            qtyOrdered: 10, unitCost: 60, discountAmount: 0, taxAmount: 0 }] },
        },
        include: { items: true },
      });

      const result = await receivePurchase(tx, {
        purchaseId: purchase.id, companyId: COMPANY_ID, branchId: warehouse.branchId,
        warehouseId: warehouse.id, receivedBy: fixture.user.id, businessDate: new Date(),
        items: [{ purchaseItemId: purchase.items[0].id, qtyReceivedNow: 10 }],
      }, randomUUID());

      const inventory = await netMovement(tx, inventoryAccountId, 'purchase_receiving', [result.receivingId]);
      // 10 units at 60 = 600 debited. Before the fix this was zero: the
      // inventory account was only ever credited, by sales and returns.
      expect(inventory.toFixed(2)).toBe('600.00');
    });
  });

  it('F-20: voiding a sale reverses its revenue and COGS to a net of zero', async () => {
    await probe(async tx => {
      const warehouse = await makeWarehouse(tx);
      const product = await makeProduct(tx);
      await tx.warehouseStock.create({
        data: { companyId: COMPANY_ID, warehouseId: warehouse.id, productId: product.id,
          qtyOnHand: 20, qtyReserved: 0, qtyInTransitOut: 0, qtyDamaged: 0, movingAverageCost: 60, version: 0 },
      });

      const sale = await postSale(tx, {
        companyId: COMPANY_ID, branchId: warehouse.branchId, warehouseId: warehouse.id,
        cashierId: fixture.user.id, currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date(),
        items: [{ productId: product.id, qty: 2, unitPrice: 100 }],
        payments: [{ paymentMethod: 'cash', amount: 200, financialAccountId: fixture.cash.id }],
      }, randomUUID());

      const sourceIds = [`${sale.saleId}:revenue`, `${sale.saleId}:cogs`];
      expect((await netMovement(tx, revenueAccountId, 'sale', sourceIds)).isZero()).toBe(false);

      await voidSale(tx, {
        saleId: sale.saleId, companyId: COMPANY_ID, voidedBy: fixture.user.id, reason: 'probe',
      }, randomUUID());

      // Reversals are keyed on the original entry id, so count both.
      const originals = await tx.journalEntry.findMany({
        where: { companyId: COMPANY_ID, sourceType: 'sale', sourceId: { in: sourceIds } },
        select: { id: true },
      });
      const reversalIds = originals.map(entry => entry.id);

      for (const [label, accountId] of [['revenue', revenueAccountId], ['cogs', cogsAccountId]] as const) {
        const original = await netMovement(tx, accountId, 'sale', sourceIds);
        const reversal = await netMovement(tx, accountId, 'journal_reversal', reversalIds);
        // The decisive assertion: the void nets the sale's GL effect to zero.
        expect(original.plus(reversal).toFixed(2), `${label} did not net to zero after void`).toBe('0.00');
      }
    });
  });

  it('F-21: a sale return posts both its credit and its COGS journals', async () => {
    await probe(async tx => {
      const warehouse = await makeWarehouse(tx);
      const product = await makeProduct(tx);
      await tx.warehouseStock.create({
        data: { companyId: COMPANY_ID, warehouseId: warehouse.id, productId: product.id,
          qtyOnHand: 20, qtyReserved: 0, qtyInTransitOut: 0, qtyDamaged: 0, movingAverageCost: 60, version: 0 },
      });

      const sale = await postSale(tx, {
        companyId: COMPANY_ID, branchId: warehouse.branchId, warehouseId: warehouse.id,
        cashierId: fixture.user.id, currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date(),
        items: [{ productId: product.id, qty: 4, unitPrice: 100 }],
        payments: [{ paymentMethod: 'cash', amount: 400, financialAccountId: fixture.cash.id }],
      }, randomUUID());

      const saleItems = await tx.saleItem.findMany({ where: { saleId: sale.saleId }, select: { id: true } });
      const result = await postSaleReturn(tx, {
        saleId: sale.saleId, companyId: COMPANY_ID, branchId: warehouse.branchId,
        warehouseId: warehouse.id, postedBy: fixture.user.id, businessDate: new Date(),
        disposition: 'restock', reason: 'probe',
        items: [{ saleItemId: saleItems[0].id, qtyReturned: 1, condition: 'good' }],
      }, randomUUID());

      const creditSource = [`${result.saleReturnId}:credit`];
      const cogsSource = [`${result.saleReturnId}:cogs`];

      // Revenue is debited back: one of four units at 100.
      const revenue = await netMovement(tx, revenueAccountId, 'sale_return', creditSource);
      expect(revenue.toFixed(2)).toBe('100.00');

      // The returned unit's cost comes back into inventory and out of COGS.
      const inventory = await netMovement(tx, inventoryAccountId, 'sale_return', cogsSource);
      const cogs = await netMovement(tx, cogsAccountId, 'sale_return', cogsSource);
      expect(inventory.toFixed(2)).toBe('60.00');
      expect(cogs.toFixed(2)).toBe('-60.00');
    });
  });
});
