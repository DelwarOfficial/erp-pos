// Supplier invoices, landed costs and gift-card tenders against the disposable
// MariaDB. Every case runs in a transaction that is rolled back.
//
//   - a supplier invoice moves the received value out of GRNI into AP, with
//     the price difference to purchase variance, and only once per purchase
//   - a landed cost raises the moving-average cost of the stock still on hand
//     through the stock ledger, sends the sold share to COGS, credits AP
//   - a gift card pays part of a sale from its balance, the sale debits the
//     gift-card liability, and a void gives the balance back
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { receivePurchase } from '@/domain/commands/m2/ReceivePurchase';
import { postSupplierInvoice } from '@/domain/commands/m2/PostSupplierInvoice';
import { postLandedCost } from '@/domain/commands/m2/PostLandedCost';
import { postSale } from '@/domain/commands/m3/PostSale';
import { voidSale } from '@/domain/commands/m3/VoidSale';
import { issueGiftCard } from '@/domain/commands/m6/Loyalty';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const COMPANY_ID = '7a2c3d4e-5f60-4b7c-9d8e-0f1a2b3c4d5e';
const ROLLBACK = new Error('ROLLBACK_PURCHASE_TENDER_PROBE');
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'PT', code: 'SYN-PT' });
}, 120_000);
afterAll(() => db.$disconnect());

async function probe(body: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await db.$transaction(async tx => { await body(tx); throw ROLLBACK; }, { timeout: 60_000 });
  } catch (error) { if (error !== ROLLBACK) throw error; }
}

const balance = async (tx: Prisma.TransactionClient, accountId: string, where: Prisma.JournalEntryWhereInput) => {
  const t = await tx.journalLine.aggregate({
    where: { companyId: COMPANY_ID, chartOfAccountId: accountId, journalEntry: { companyId: COMPANY_ID, status: { in: ['posted', 'reversed'] }, ...where } },
    _sum: { debitBase: true, creditBase: true },
  });
  return new Prisma.Decimal(t._sum.debitBase ?? 0).minus(t._sum.creditBase ?? 0);
};

async function setup(tx: Prisma.TransactionClient) {
  const branch = fx.branches[0];
  let warehouse = await tx.warehouse.findFirst({ where: { companyId: COMPANY_ID, branchId: branch.id } });
  if (!warehouse) warehouse = await tx.warehouse.create({ data: { companyId: COMPANY_ID, branchId: branch.id, code: 'WH-PT', name: 'PT warehouse', isActive: true } });
  let unit = await tx.unit.findFirst({ where: { companyId: COMPANY_ID } });
  if (!unit) unit = await tx.unit.create({ data: { companyId: COMPANY_ID, code: 'pc', name: 'Piece' } });
  let category = await tx.category.findFirst({ where: { companyId: COMPANY_ID } });
  if (!category) category = await tx.category.create({ data: { companyId: COMPANY_ID, code: 'gen', name: 'General' } });
  const product = await tx.product.create({ data: {
    companyId: COMPANY_ID, code: `PT-${randomUUID().slice(0, 8)}`, name: 'PT product', productType: 'standard',
    unitId: unit.id, categoryId: category.id, defaultPrice: 100, referenceCost: 60, isActive: true,
  } });
  const supplier = await tx.supplier.create({ data: { companyId: COMPANY_ID, name: `PT supplier ${randomUUID().slice(0, 6)}` } });
  // A goods-received-not-invoiced account, as onboarding's chart sets up.
  const grni = await tx.chartOfAccount.create({ data: { companyId: COMPANY_ID, code: `grni-${randomUUID().slice(0, 6)}`, name: 'GRNI',
    accountClass: 'liability', accountSubtype: 'current_liability', normalBalance: 'C', isActive: true } });
  const policy = await tx.accountingPolicy.update({ where: { companyId: COMPANY_ID }, data: { grniAccountId: grni.id } });
  const purchase = await tx.purchase.create({ data: {
    companyId: COMPANY_ID, branchId: warehouse.branchId, warehouseId: warehouse.id, supplierId: supplier.id,
    referenceNo: `PO-${randomUUID().slice(0, 8)}`, orderStatus: 'ordered', orderDate: new Date(), currencyCode: 'BDT', exchangeRate: 1,
    subtotal: 600, grandTotal: 600, baseGrandTotal: 600, createdBy: fx.user.id,
    items: { create: [{ companyId: COMPANY_ID, lineNo: 1, productId: product.id, productNameSnapshot: product.name,
      productCodeSnapshot: product.code, qtyOrdered: 10, unitCost: 60, discountAmount: 0, taxAmount: 0 }] },
  }, include: { items: true } });
  const received = await receivePurchase(tx, {
    purchaseId: purchase.id, companyId: COMPANY_ID, branchId: warehouse.branchId, warehouseId: warehouse.id,
    receivedBy: fx.user.id, businessDate: new Date(), items: [{ purchaseItemId: purchase.items[0].id, qtyReceivedNow: 10 }],
  }, randomUUID());
  return { warehouse, product, supplier, purchase, policy, grni, receivingId: received.receivingId };
}

describe('supplier invoice', () => {
  it('clears GRNI into the supplier payable, books the price difference, and only once', async () => {
    await probe(async tx => {
      const s = await setup(tx);
      expect((await balance(tx, s.grni.id, { sourceType: 'purchase_receiving', sourceId: s.receivingId })).toFixed(2)).toBe('-600.00');

      const result = await postSupplierInvoice(tx, { companyId: COMPANY_ID, purchaseId: s.purchase.id, supplierInvoiceNo: 'INV-77',
        invoiceDate: new Date(), amount: '640.00', postedBy: fx.user.id }, randomUUID());
      expect(result).toMatchObject({ receivedValue: '600.00', invoiceBase: '640.00', variance: '40.00' });

      const invoice = { sourceType: 'supplier_invoice', sourceId: s.purchase.id };
      expect((await balance(tx, s.grni.id, invoice)).toFixed(2)).toBe('600.00');
      expect((await balance(tx, s.policy.purchaseVarianceAccountId, invoice)).toFixed(2)).toBe('40.00');
      expect((await balance(tx, s.policy.apAccountId, invoice)).toFixed(2)).toBe('-640.00');
      const apLine = await tx.journalLine.findFirstOrThrow({ where: { companyId: COMPANY_ID, chartOfAccountId: s.policy.apAccountId, journalEntry: invoice } });
      expect(apLine.supplierId).toBe(s.supplier.id);
      expect((await tx.purchase.findUniqueOrThrow({ where: { id: s.purchase.id } })).invoiceStatus).toBe('invoiced');

      await expect(postSupplierInvoice(tx, { companyId: COMPANY_ID, purchaseId: s.purchase.id, supplierInvoiceNo: 'INV-78',
        invoiceDate: new Date(), amount: '640.00', postedBy: fx.user.id }, randomUUID())).rejects.toThrow(/already has its supplier invoice/);
    });
  });
});

describe('landed cost', () => {
  it('raises the average cost of stock on hand, sends the sold share to COGS, and credits AP', async () => {
    await probe(async tx => {
      const s = await setup(tx);
      // Sell 4 of the 10 received at 60 each: 6 remain at 60.
      await postSale(tx, { companyId: COMPANY_ID, branchId: s.warehouse.branchId, warehouseId: s.warehouse.id, cashierId: fx.user.id,
        currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date(), items: [{ productId: s.product.id, qty: 4, unitPrice: 100 }],
        payments: [{ paymentMethod: 'cash', amount: 400, financialAccountId: fx.cash.id }] }, randomUUID());

      const doc = await postLandedCost(tx, { companyId: COMPANY_ID, purchaseId: s.purchase.id, costType: 'freight', currencyCode: 'BDT',
        exchangeRate: 1, amount: 100, allocationMethod: 'quantity', postedBy: fx.user.id }, randomUUID());

      // 100 over 10 received: 60 rides on the 6 still here, 40 was already sold.
      const stock = await tx.warehouseStock.findUniqueOrThrow({ where: { companyId_warehouseId_productId: { companyId: COMPANY_ID, warehouseId: s.warehouse.id, productId: s.product.id } } });
      expect(stock.qtyOnHand.toString()).toBe('6');
      expect(new Prisma.Decimal(stock.movingAverageCost).toFixed(2)).toBe('70.00');
      const ledger = await tx.stockMovement.aggregate({ where: { companyId: COMPANY_ID, referenceType: 'landed_cost', referenceId: doc.landedCostDocumentId }, _sum: { totalCostDelta: true, qtyDelta: true } });
      expect(new Prisma.Decimal(ledger._sum.totalCostDelta ?? 0).toFixed(2)).toBe('60.00');
      expect(new Prisma.Decimal(ledger._sum.qtyDelta ?? 0).toString()).toBe('0');

      const lc = { sourceType: 'landed_cost', sourceId: doc.landedCostDocumentId };
      expect((await balance(tx, s.policy.inventoryAccountId, lc)).toFixed(2)).toBe('60.00');
      expect((await balance(tx, s.policy.cogsAccountId, lc)).toFixed(2)).toBe('40.00');
      expect((await balance(tx, s.policy.apAccountId, lc)).toFixed(2)).toBe('-100.00');
    });
  });

  it('refuses manual allocations that do not add up or name another purchase’s line', async () => {
    await probe(async tx => {
      const s = await setup(tx);
      const base = { companyId: COMPANY_ID, purchaseId: s.purchase.id, costType: 'customs', currencyCode: 'BDT', exchangeRate: 1, amount: 100, allocationMethod: 'manual', postedBy: fx.user.id };
      await expect(postLandedCost(tx, { ...base, manualAllocations: [{ purchaseItemId: s.purchase.items[0].id, allocatedBaseAmount: 90 }] }, randomUUID())).rejects.toThrow(/add up to 90.00/);
      await expect(postLandedCost(tx, { ...base, manualAllocations: [{ purchaseItemId: randomUUID(), allocatedBaseAmount: 100 }] }, randomUUID())).rejects.toThrow(/not on this purchase/);
    });
  });
});

describe('gift card tender', () => {
  it('pays part of a sale from the card, debits the liability, and a void gives the balance back', async () => {
    await probe(async tx => {
      const s = await setup(tx);
      const card = await issueGiftCard(tx, { companyId: COMPANY_ID, branchId: s.warehouse.branchId, faceValue: '200.00', issuedBy: fx.user.id,
        mode: 'sold', financialAccountId: fx.cash.id, cashReceived: true }, randomUUID());
      const cardBalance = async () => new Prisma.Decimal((await tx.giftCardTransaction.aggregate({ where: { giftCardId: card.giftCardId }, _sum: { amountDelta: true } }))._sum.amountDelta ?? 0).toFixed(2);

      const sale = await postSale(tx, { companyId: COMPANY_ID, branchId: s.warehouse.branchId, warehouseId: s.warehouse.id, cashierId: fx.user.id,
        currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date(), items: [{ productId: s.product.id, qty: 2, unitPrice: 100 }],
        payments: [
          { paymentMethod: 'gift_card', amount: 150, financialAccountId: fx.cash.id, methodReference: card.code },
          { paymentMethod: 'cash', amount: 50, financialAccountId: fx.cash.id },
        ] }, randomUUID());
      expect(await cardBalance()).toBe('50.00');
      const revenue = { sourceType: 'sale', sourceId: `${sale.saleId}:revenue` };
      expect((await balance(tx, s.policy.giftCardLiabilityAccountId, revenue)).toFixed(2)).toBe('150.00');

      // More than is left on the card is refused.
      await expect(postSale(tx, { companyId: COMPANY_ID, branchId: s.warehouse.branchId, warehouseId: s.warehouse.id, cashierId: fx.user.id,
        currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date(), items: [{ productId: s.product.id, qty: 1, unitPrice: 100 }],
        payments: [{ paymentMethod: 'gift_card', amount: 100, financialAccountId: fx.cash.id, methodReference: card.code }] }, randomUUID()))
        .rejects.toThrow(/less than/);

      await voidSale(tx, { saleId: sale.saleId, companyId: COMPANY_ID, voidedBy: fx.user.id, reason: 'probe' }, randomUUID());
      expect(await cardBalance()).toBe('200.00');
    });
  });
});
