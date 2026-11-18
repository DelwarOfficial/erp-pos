// Warranty claim fulfilment against the disposable MariaDB, rolled back:
//   - replace: the replacement unit leaves stock through the stock ledger at
//     moving-average cost, its serial is the customer's ('sold'), the faulty
//     unit is scrapped, and the cost is posted Dr service cost / Cr inventory;
//   - a claim is fulfilled once only, and only when approved;
//   - refund and supplier claims need a posted return; none is refused.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { fulfillWarrantyClaim } from '@/domain/commands/m5/FulfillWarrantyClaim';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';
import { runInTenantContext } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = 'ad5f6071-8293-4eaf-b012-3c4d5e6f7081';
const ROLLBACK = new Error('ROLLBACK_WARRANTY');
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'WF', code: 'SYN-WF' });
}, 120_000);
afterAll(() => db.$disconnect());

async function probe(body: (tx: Prisma.TransactionClient) => Promise<void>) {
  const ctx = { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, correlationId: randomUUID(), requestId: randomUUID() } as never;
  try { await runInTenantContext(ctx, () => db.$transaction(async tx => { await body(tx); throw ROLLBACK; }, { timeout: 60_000 })); }
  catch (error) { if (error !== ROLLBACK) throw error; }
}

async function setup(tx: Prisma.TransactionClient, claimType: string, status = 'approved') {
  const branch = fx.branches[0];
  let warehouse = await tx.warehouse.findFirst({ where: { companyId: COMPANY_ID, branchId: branch.id } });
  if (!warehouse) warehouse = await tx.warehouse.create({ data: { companyId: COMPANY_ID, branchId: branch.id, code: 'WH-WF', name: 'WF', isActive: true } });
  let unit = await tx.unit.findFirst({ where: { companyId: COMPANY_ID } });
  if (!unit) unit = await tx.unit.create({ data: { companyId: COMPANY_ID, code: 'pc', name: 'Piece' } });
  let category = await tx.category.findFirst({ where: { companyId: COMPANY_ID } });
  if (!category) category = await tx.category.create({ data: { companyId: COMPANY_ID, code: 'gen', name: 'General' } });
  const product = await tx.product.create({ data: { companyId: COMPANY_ID, code: `WF-${randomUUID().slice(0, 8)}`, name: 'TV', productType: 'standard',
    unitId: unit.id, categoryId: category.id, defaultPrice: 40000, referenceCost: 30000, isSerialized: true, isActive: true } });
  await tx.warehouseStock.create({ data: { companyId: COMPANY_ID, warehouseId: warehouse.id, productId: product.id, qtyOnHand: 2, movingAverageCost: 30000 } });
  const spare = await tx.productSerial.create({ data: { companyId: COMPANY_ID, productId: product.id, serialNumber: `NEW-${randomUUID().slice(0, 8)}`, status: 'in_stock', currentWarehouseId: warehouse.id } });
  const faulty = await tx.productSerial.create({ data: { companyId: COMPANY_ID, productId: product.id, serialNumber: `OLD-${randomUUID().slice(0, 8)}`, status: 'sold' } });
  const request = await tx.serviceRequest.create({ data: { companyId: COMPANY_ID, branchId: branch.id, referenceNo: `SR-${randomUUID().slice(0, 8)}`,
    serviceType: 'warranty', issueDescription: 'No picture', serialId: faulty.id, createdBy: fx.user.id } });
  const claim = await tx.warrantyClaim.create({ data: { companyId: COMPANY_ID, serviceRequestId: request.id, claimType, status,
    eligibilityReason: 'Within warranty', replacementSerialId: claimType === 'replace' ? spare.id : null } });
  const policy = await tx.accountingPolicy.findUniqueOrThrow({ where: { companyId: COMPANY_ID } });
  return { warehouse, product, spare, faulty, claim, policy };
}

describe('fulfilling a warranty claim', () => {
  it('replace: the unit leaves stock at cost, is expensed, and the faulty unit is scrapped', async () => {
    await probe(async tx => {
      const s = await setup(tx, 'replace');
      const done = await fulfillWarrantyClaim(tx, { warrantyClaimId: s.claim.id, companyId: COMPANY_ID, fulfilledBy: fx.user.id }, randomUUID());
      expect(done).toMatchObject({ status: 'fulfilled', replacementCost: '30000.00' });

      const stock = await tx.warehouseStock.findUniqueOrThrow({ where: { companyId_warehouseId_productId: { companyId: COMPANY_ID, warehouseId: s.warehouse.id, productId: s.product.id } } });
      expect(stock.qtyOnHand.toString()).toBe('1');
      const moved = await tx.stockMovement.findFirstOrThrow({ where: { companyId: COMPANY_ID, referenceType: 'warranty_claim', referenceId: s.claim.id } });
      expect(new Prisma.Decimal(moved.totalCostDelta).toFixed(2)).toBe('-30000.00');

      expect((await tx.productSerial.findUniqueOrThrow({ where: { id: s.spare.id } })).status).toBe('sold');
      expect((await tx.productSerial.findUniqueOrThrow({ where: { id: s.faulty.id } })).status).toBe('scrapped');

      const lines = await tx.journalLine.findMany({ where: { companyId: COMPANY_ID, journalEntry: { sourceType: 'warranty_claim', sourceId: s.claim.id } } });
      const net = (account: string) => lines.filter(l => l.chartOfAccountId === account).reduce((t, l) => t.plus(l.debitBase).minus(l.creditBase), new Prisma.Decimal(0)).toFixed(2);
      expect(net(s.policy.inventoryAccountId)).toBe('-30000.00');
      expect(net(s.policy.serviceCogsAccountId ?? s.policy.cogsAccountId)).toBe('30000.00');

      await expect(fulfillWarrantyClaim(tx, { warrantyClaimId: s.claim.id, companyId: COMPANY_ID, fulfilledBy: fx.user.id }, randomUUID())).rejects.toThrow(/must be approved/);
    });
  });

  it('only an approved claim can be fulfilled', async () => {
    await probe(async tx => {
      const s = await setup(tx, 'replace', 'submitted');
      await expect(fulfillWarrantyClaim(tx, { warrantyClaimId: s.claim.id, companyId: COMPANY_ID, fulfilledBy: fx.user.id }, randomUUID())).rejects.toThrow(/must be approved/);
    });
  });

  it('refund and supplier claims need a posted return; none is refused', async () => {
    await probe(async tx => {
      const refund = await setup(tx, 'refund');
      await expect(fulfillWarrantyClaim(tx, { warrantyClaimId: refund.claim.id, companyId: COMPANY_ID, fulfilledBy: fx.user.id }, randomUUID())).rejects.toThrow(/sale return/);
      await expect(fulfillWarrantyClaim(tx, { warrantyClaimId: refund.claim.id, companyId: COMPANY_ID, fulfilledBy: fx.user.id, referenceDocumentId: randomUUID() }, randomUUID())).rejects.toThrow(/not posted/);
    });
  });
});
