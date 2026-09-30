// F-71: saving a large count is a handful of bulk statements, not one round
// trip per line, and records every line and scanned serial correctly.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { withTenant } from '@/lib/db/transaction';
import { createStockCount } from '@/domain/commands/m2/CreateStockCount';
import { updateStockCount } from '@/domain/commands/m2/UpdateStockCount';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const A: string = randomUUID();
const LINES = 2000;
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let warehouseId: string;
let serializedId: string;
let countId: string;
let phoneLineId: string;
const ctx = () => ({ companyId: A, branchIds: [], allBranches: true, isGlobal: false, userId: undefined, correlationId: randomUUID(), requestId: randomUUID() }) as never;

beforeAll(async () => {
  fx = await ensureSyntheticIssuerTenant(db, { companyId: A, label: 'SC', code: `SYN-SC-${A.slice(0, 8)}` });
  warehouseId = (await db.warehouse.create({ data: { companyId: A, branchId: fx.branches[0].id, name: 'SC', code: 'SC' } })).id;
  const category = await db.category.create({ data: { companyId: A, name: 'SC', code: 'SCCAT' } });
  const unit = await db.unit.create({ data: { companyId: A, name: 'Piece', code: 'SCPC' } });
  await db.product.createMany({ data: Array.from({ length: LINES }, (_, i) => ({ companyId: A, name: `Item ${i}`, code: `SC-${i}`, categoryId: category.id, unitId: unit.id })) });
  serializedId = (await db.product.create({ data: { companyId: A, name: 'Phone', code: 'SC-PHONE', categoryId: category.id, unitId: unit.id, isSerialized: true } })).id;
  await db.productSerial.createMany({ data: ['IMEI-1', 'IMEI-2', 'IMEI-3'].map(serialNumber => ({ companyId: A, productId: serializedId, serialNumber, currentWarehouseId: warehouseId, status: 'in_stock' })) });
}, 300_000);
afterAll(() => db.$disconnect());

describe('saving a stock count', () => {
  it(`saves ${LINES} lines and serial scans in bulk`, async () => {
    const products = await db.product.findMany({ where: { companyId: A }, select: { id: true } });
    const created = await withTenant(ctx(), tx => createStockCount(tx, {
      companyId: A, branchId: fx.branches[0].id, warehouseId, scopeType: 'selected', blindCount: false, movementFreezePolicy: 'warn',
      items: products.map(p => ({ productId: p.id, expectedQuantity: p.id === serializedId ? 3 : 0 })), post: false, createdBy: fx.user.id,
    }, randomUUID()), { timeout: 120_000 }) as { id: string };
    await withTenant(ctx(), tx => updateStockCount(tx, { companyId: A, id: created.id, userId: fx.user.id, action: 'start' }, randomUUID()));

    const lines = await db.stockCountItem.findMany({ where: { stockCountId: created.id }, select: { id: true, productId: true } });
    const items = lines.map((line, i) => line.productId === serializedId
      ? { id: line.id, quantity: 2, serialNumbers: ['IMEI-1', 'IMEI-3'], note: 'one missing' }
      : { id: line.id, quantity: i % 7, note: i % 7 ? 'found' : undefined });

    const started = Date.now();
    await withTenant(ctx(), tx => updateStockCount(tx, { companyId: A, id: created.id, userId: fx.user.id, action: 'save', items }, randomUUID()));
    expect(Date.now() - started).toBeLessThan(20_000);

    const saved = await db.stockCountItem.findMany({ where: { stockCountId: created.id } });
    const byId = new Map(items.map(item => [item.id, item]));
    for (const line of saved) {
      const item = byId.get(line.id)!;
      expect(new Prisma.Decimal(line.countedQuantity!).toNumber()).toBe(item.quantity);
      expect(new Prisma.Decimal(line.varianceQuantity!).toFixed()).toBe(new Prisma.Decimal(item.quantity).minus(line.expectedQuantity).toFixed());
      expect(line.countNote).toBe(item.note ?? null);
    }
    const phoneLine = saved.find(line => line.productId === serializedId)!;
    countId = created.id; phoneLineId = phoneLine.id;
    const serials = await db.stockCountSerial.findMany({ where: { stockCountItemId: phoneLine.id }, orderBy: { scannedSerialNumber: 'asc' } });
    expect(serials.map(s => [s.scannedSerialNumber, s.countedPresent, s.resolution])).toEqual([
      ['IMEI-1', true, 'matched'], ['IMEI-2', false, 'missing'], ['IMEI-3', true, 'matched'],
    ]);
  }, 180_000);

  it('refuses a serial that is not in this warehouse, changing nothing', async () => {
    await expect(withTenant(ctx(), tx => updateStockCount(tx, { companyId: A, id: countId, userId: fx.user.id, action: 'save',
      items: [{ id: phoneLineId, quantity: 1, serialNumbers: ['NOT-HERE'] }] }, randomUUID()))).rejects.toMatchObject({ code: 'SERIAL_NOT_AVAILABLE' });
    const line = await db.stockCountItem.findUniqueOrThrow({ where: { id: phoneLineId } });
    expect(new Prisma.Decimal(line.countedQuantity!).toFixed()).toBe('2');
  });
});
