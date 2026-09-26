// F-71 regression: the largest offline batch the API accepts (200 commands; it was 500),
// applied in the route's own transaction (withTenant: Serializable, 30 s).
//
// Each command was checked for a duplicate sequence with its own query and
// recorded with its own insert, inside the transaction that also posts every
// sale. This runs 500 real offline cash sales through syncOfflineBatch on the
// disposable MariaDB, then replays the batch to check duplicate detection.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { withTenant } from '@/lib/db/transaction';
import { syncOfflineBatch, type OfflineSyncCommand } from '@/domain/offline/syncOfflineBatch';
import { OFFLINE_SYNC_MAX_COMMANDS } from '@/app/api/v1/offline/sync/route';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const COMPANY = randomUUID();
const COMMANDS = OFFLINE_SYNC_MAX_COMMANDS;
let commands: OfflineSyncCommand[];
let deviceId: string;
let userId: string;
let productId: string;
let warehouseId: string;

const ctx = () => ({
  companyId: COMPANY, branchIds: [], allBranches: true, isGlobal: false,
  correlationId: randomUUID(), requestId: randomUUID(),
}) as never;
const hash = (payload: unknown) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

beforeAll(async () => {
  const fixture = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY, label: 'OS', code: `SYN-OS-${COMPANY.slice(0, 8)}` });
  userId = fixture.user.id;
  const branchId = fixture.branches[0].id;
  warehouseId = (await db.warehouse.create({ data: { companyId: COMPANY, branchId, name: 'Offline WH', code: 'OSWH' } })).id;
  const category = await db.category.create({ data: { companyId: COMPANY, name: 'Offline', code: 'OSCAT' } });
  const unit = await db.unit.create({ data: { companyId: COMPANY, name: 'Piece', code: 'OSPC' } });
  productId = (await db.product.create({ data: { companyId: COMPANY, name: 'Offline item', code: 'OS-1', categoryId: category.id, unitId: unit.id, defaultPrice: 100, referenceCost: 60 } })).id;
  await db.warehouseStock.create({ data: { companyId: COMPANY, warehouseId, productId, qtyOnHand: 10_000, movingAverageCost: 60 } });
  deviceId = (await db.device.create({ data: { companyId: COMPANY, branchId, label: 'Till', devicePublicKey: randomUUID(), registeredBy: userId, status: 'active' } })).id;

  commands = Array.from({ length: COMMANDS }, (_, i) => {
    const payload = {
      branch_id: branchId, warehouse_id: warehouseId, currency_code: 'BDT', exchange_rate: 1,
      business_date: new Date().toISOString(),
      items: [{ product_id: productId, qty: 1, unit_price: 100 }],
      payments: [{ payment_method: 'cash', amount: 100, financial_account_id: fixture.cash.id }],
    };
    return { command_type: 'cash_sale', sequence_number: i + 1, payload, payload_hash: hash(payload), idempotency_key: `os-${COMPANY}-${i}` };
  });
}, 120_000);

afterAll(() => db.$disconnect());

describe('offline sync at the batch limit', () => {
  it('applies every sale inside the route transaction\'s timeout', async () => {
    const started = Date.now();
    const result = await withTenant(ctx(), tx => syncOfflineBatch(tx, { companyId: COMPANY, userId, deviceId, commands }, randomUUID()));
    const elapsedMs = Date.now() - started;
    console.log(`F-71 offline sync: ${COMMANDS} cash sales applied in ${elapsedMs} ms`);

    expect(result.body).toMatchObject({ synced_count: COMMANDS, applied_count: COMMANDS, conflict_count: 0, status: 'completed' });
    expect(elapsedMs).toBeLessThan(30_000);
    expect(await db.sale.count({ where: { companyId: COMPANY } })).toBe(COMMANDS);
    const stock = await db.warehouseStock.findFirstOrThrow({ where: { companyId: COMPANY, warehouseId, productId } });
    expect(stock.qtyOnHand.toFixed(0)).toBe(String(10_000 - COMMANDS));
  }, 120_000);

  it('treats a replayed batch as duplicates and posts nothing twice', async () => {
    const result = await withTenant(ctx(), tx => syncOfflineBatch(tx, { companyId: COMPANY, userId, deviceId, commands }, randomUUID()));
    expect(result.body).toMatchObject({ synced_count: 0, applied_count: 0, conflict_count: 0 });
    expect(result.body.results.every((r: { status: string }) => r.status === 'duplicate')).toBe(true);
    expect(await db.sale.count({ where: { companyId: COMPANY } })).toBe(COMMANDS);
  }, 120_000);

  it('flags a changed payload under a used sequence number as a conflict', async () => {
    const payload = { ...commands[0].payload, business_date: new Date(Date.now() + 1000).toISOString() };
    const changed = { ...commands[0], payload, payload_hash: hash(payload) };
    const result = await withTenant(ctx(), tx => syncOfflineBatch(tx, { companyId: COMPANY, userId, deviceId, commands: [changed] }, randomUUID()));
    expect(result.body).toMatchObject({ conflict_count: 1, applied_count: 0, status: 'partial' });
    expect(await db.sale.count({ where: { companyId: COMPANY } })).toBe(COMMANDS);
  }, 60_000);
});
