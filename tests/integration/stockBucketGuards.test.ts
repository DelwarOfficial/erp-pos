// F-33: a movement that would drive any stock bucket negative is refused with
// a 409 naming the bucket, before the database CHECK is reached. Disposable MariaDB.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { withTenant } from '@/lib/db/transaction';
import { postStockMovement, type StockBucket } from '@/domain/inventory/stockMovement';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const A: string = randomUUID();
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let warehouseId: string;
let productId: string;
const ctx = () => ({ companyId: A, branchIds: [], allBranches: true, isGlobal: false, userId: undefined, correlationId: randomUUID(), requestId: randomUUID() }) as never;

async function move(bucket: StockBucket, qtyDelta: number, movementType: 'adjustment_out' | 'adjustment_in' | 'damage_move' = 'adjustment_out') {
  const event = await db.businessEvent.create({ data: { companyId: A, eventType: 'test.move', sourceType: 'test', sourceId: randomUUID(), correlationId: randomUUID() } });
  return withTenant(ctx(), tx => postStockMovement(tx, {
    companyId: A, eventId: event.id, eventLineNo: 1, warehouseId, productId, stockBucket: bucket, movementType, qtyDelta, unitCost: 10,
    referenceType: 'test', referenceId: randomUUID(), effectiveAt: new Date(), createdBy: fx.user.id,
  }));
}

beforeAll(async () => {
  fx = await ensureSyntheticIssuerTenant(db, { companyId: A, label: 'SB', code: `SYN-SB-${A.slice(0, 8)}` });
  warehouseId = (await db.warehouse.create({ data: { companyId: A, branchId: fx.branches[0].id, name: 'SB', code: 'SB' } })).id;
  const category = await db.category.create({ data: { companyId: A, name: 'SB', code: 'SBCAT' } });
  const unit = await db.unit.create({ data: { companyId: A, name: 'Piece', code: 'SBPC' } });
  productId = (await db.product.create({ data: { companyId: A, name: 'Widget', code: 'SB-1', categoryId: category.id, unitId: unit.id } })).id;
}, 120_000);
afterAll(() => db.$disconnect());

describe('stock bucket guards', () => {
  it('refuses to take more than is on hand, naming the bucket', async () => {
    await move('on_hand', 2, 'adjustment_in');
    await expect(move('on_hand', -3)).rejects.toMatchObject({ code: 'INVENTORY_INSUFFICIENT', httpStatus: 409, details: { bucket: 'on_hand', available: '2', requested: '3' } });
  });

  it.each(['damaged', 'in_transit'] as const)('refuses to drive the %s bucket negative with a 409', async bucket => {
    await expect(move(bucket, -1, 'damage_move')).rejects.toMatchObject({ code: 'INVENTORY_INSUFFICIENT', httpStatus: 409, details: { bucket } });
    const stock = await db.warehouseStock.findFirstOrThrow({ where: { companyId: A, warehouseId, productId } });
    expect(new Prisma.Decimal(stock.qtyDamaged).toFixed()).toBe('0');
    expect(new Prisma.Decimal(stock.qtyInTransitOut).toFixed()).toBe('0');
  });

  it('keeps fractional bucket quantities exact', async () => {
    await move('damaged', 0.3, 'damage_move');
    await move('damaged', 0.1, 'damage_move');
    await move('damaged', -0.4, 'damage_move');
    const stock = await db.warehouseStock.findFirstOrThrow({ where: { companyId: A, warehouseId, productId } });
    expect(new Prisma.Decimal(stock.qtyDamaged).toFixed()).toBe('0');
  });
});
