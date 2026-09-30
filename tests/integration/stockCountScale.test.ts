// F-71 regression: a 5,000-line stock count, created and posted in the route's
// own transaction (withTenant: Serializable, with the route's timeout).
//
// Every line was its own round trip, and posting ran postStockMovement per
// line: some 10,000 sequential statements inside a 30-second transaction,
// which a 5,000-line count overran. Lines and movements are now written in
// bulk, and the route's transaction has a measured timeout of its own. This
// runs the same unit of work end to end on the disposable MariaDB and checks
// it finishes inside that timeout and posts exactly.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { withTenant } from '@/lib/db/transaction';
import { createStockCount, STOCK_COUNT_TRANSACTION_TIMEOUT_MS } from '@/domain/commands/m2/CreateStockCount';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const COMPANY = randomUUID();
const LINES = 5_000;
let branchId: string;
let warehouseId: string;
let userId: string;
let productIds: string[];

// Each test's writes are rolled back: movements are immutable by trigger, so a
// committed 5,000-line count could never be removed, and every run would grow
// the disposable database and slow the next.
const ROLLBACK = new Error('ROLLBACK_STOCK_COUNT_PROBE');
async function probe(context: never, work: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await withTenant(context, async tx => { await work(tx); throw ROLLBACK; }, { timeout: STOCK_COUNT_TRANSACTION_TIMEOUT_MS });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

const ctx = (branchIds?: string[]) => ({
  companyId: COMPANY, branchIds: branchIds ?? [], allBranches: !branchIds, isGlobal: false,
  correlationId: randomUUID(), requestId: randomUUID(),
}) as never;

beforeAll(async () => {
  const fixture = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY, label: 'SC', code: `SYN-SC-${COMPANY.slice(0, 8)}` });
  branchId = fixture.branches[0].id;
  userId = fixture.user.id;
  await db.accountingPolicy.update({ where: { companyId: COMPANY }, data: { inventoryWriteOffAccountId: fixture.expense.id } });
  warehouseId = (await db.warehouse.create({ data: { companyId: COMPANY, branchId, name: 'Count WH', code: 'SCWH' } })).id;
  const category = await db.category.create({ data: { companyId: COMPANY, name: 'Count', code: 'SCCAT' } });
  const unit = await db.unit.create({ data: { companyId: COMPANY, name: 'Piece', code: 'SCPC' } });
  const prefix = `sc-${COMPANY.slice(0, 8)}-`;
  await db.$executeRawUnsafe(`
    INSERT INTO products (id, company_id, name, code, category_id, unit_id)
    SELECT CONCAT(?, seq), ?, CONCAT('Counted ', seq), CONCAT('SC-', LPAD(seq, 6, '0')), ?, ? FROM seq_1_to_${LINES}`,
  prefix, COMPANY, category.id, unit.id);
  // Every line: 10 on hand at 2.50.
  await db.$executeRawUnsafe(`
    INSERT INTO warehouse_stocks (id, company_id, warehouse_id, product_id, qty_on_hand, moving_average_cost)
    SELECT CONCAT(?, 'ws-', seq), ?, ?, CONCAT(?, seq), 10, 2.5 FROM seq_1_to_${LINES}`,
  prefix, COMPANY, warehouseId, prefix);
  productIds = Array.from({ length: LINES }, (_, i) => `${prefix}${i + 1}`);
}, 120_000);

afterAll(async () => {
  // The seed is plain rows; nothing committed references it.
  await db.stockCount.deleteMany({ where: { companyId: COMPANY } });
  await db.warehouseStock.deleteMany({ where: { companyId: COMPANY } });
  await db.product.deleteMany({ where: { companyId: COMPANY } });
  await db.$disconnect();
}, 120_000);

describe('stock count at 5,000 lines', () => {
  it('creates and posts inside the route transaction\'s timeout, exactly', async () => {
    // Lines alternate: counted 10.3333 (gain 0.3333), counted 9 (loss 1), counted 10 (no variance).
    const counted = (i: number) => ['10.3333', '9', '10'][i % 3];
    await probe(ctx(), async tx => {
      const started = Date.now();
      const result = await createStockCount(tx, {
        companyId: COMPANY, branchId, warehouseId, scopeType: 'all', blindCount: true, movementFreezePolicy: 'warn',
        createdBy: userId, post: true,
        items: productIds.map((productId, i) => ({ productId, expectedQuantity: '10', countedQuantity: counted(i) })),
      }, randomUUID());
      const elapsedMs = Date.now() - started;
      console.log(`F-71 stock count: ${LINES} lines created and posted in ${elapsedMs} ms`);

      const gains = Math.ceil(LINES / 3);                 // i % 3 === 0
      const losses = Math.ceil((LINES - 1) / 3);          // i % 3 === 1
      expect(result).toMatchObject({ status: 'posted', itemsCount: LINES, adjustmentsPosted: gains + losses });
      expect(elapsedMs).toBeLessThan(STOCK_COUNT_TRANSACTION_TIMEOUT_MS);

      const lines = await tx.stockCountItem.aggregate({ where: { companyId: COMPANY, stockCountId: result.id }, _count: { _all: true }, _sum: { varianceQuantity: true } });
      expect(lines._count._all).toBe(LINES);
      // Decimal, exactly: 1,667 × 0.3333 − 1,667 × 1.
      expect(lines._sum.varianceQuantity!.toFixed(4)).toBe('-1111.3889');

      const stock = await tx.warehouseStock.aggregate({ where: { companyId: COMPANY, warehouseId }, _sum: { qtyOnHand: true } });
      expect(stock._sum.qtyOnHand!.toFixed(4)).toBe(new Prisma.Decimal(LINES * 10).minus('1111.3889').toFixed(4));
      const movements = await tx.stockMovement.aggregate({ where: { companyId: COMPANY, referenceId: result.id }, _count: { _all: true }, _sum: { qtyDelta: true } });
      expect(movements._count._all).toBe(gains + losses);
      expect(movements._sum.qtyDelta!.toFixed(4)).toBe('-1111.3889');
    });
  }, 180_000);

  it('stays inside the timeout for a user limited to the branch', async () => {
    // For a branch-limited user the tenant extension checks each inserted line's
    // parent count against the user's branches; it did so once per line.
    await probe(ctx([branchId]), async tx => {
      const started = Date.now();
      const result = await createStockCount(tx, {
        companyId: COMPANY, branchId, warehouseId, scopeType: 'all', blindCount: true, movementFreezePolicy: 'warn',
        createdBy: userId, post: false,
        items: productIds.map(productId => ({ productId, expectedQuantity: '10', countedQuantity: '10' })),
      }, randomUUID());
      const elapsedMs = Date.now() - started;
      console.log(`F-71 stock count, branch-limited: ${LINES} lines created in ${elapsedMs} ms`);
      expect(result).toMatchObject({ status: 'draft', itemsCount: LINES });
      expect(await tx.stockCountItem.count({ where: { stockCountId: result.id } })).toBe(LINES);
      expect(elapsedMs).toBeLessThan(STOCK_COUNT_TRANSACTION_TIMEOUT_MS);
    });
  }, 180_000);

  it('still refuses a user outside the count\'s branch, before inserting anything', async () => {
    // The per-operation cache must record only parents that passed the check.
    const other = (await db.branch.findFirstOrThrow({ where: { companyId: COMPANY, NOT: { id: branchId } } })).id;
    const count = await db.stockCount.create({ data: { companyId: COMPANY, branchId, warehouseId, referenceNo: `SC-DENY-${randomUUID().slice(0, 8)}`, createdBy: userId } });
    await expect(withTenant(ctx([other]), tx => tx.stockCountItem.createMany({
      data: productIds.slice(0, 50).map(productId => ({ companyId: COMPANY, stockCountId: count.id, productId, expectedQuantity: 1 })),
    }))).rejects.toThrow(/outside authorized tenant\/branch scope/);
    expect(await db.stockCountItem.count({ where: { stockCountId: count.id } })).toBe(0);
  }, 60_000);
});
