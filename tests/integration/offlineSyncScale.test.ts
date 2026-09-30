// F-71 regression: the largest offline batch the API accepts (100 commands; it was 500, then 200),
// applied in the route's own transaction (withTenant: Serializable, 30 s).
//
// Each command was checked for a duplicate sequence with its own query and
// recorded with its own insert, inside the transaction that also posts every
// sale. This runs 100 real offline cash sales through syncOfflineBatch on the
// disposable MariaDB, replays the batch to check duplicate detection, and rolls
// everything back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { withTenant } from '@/lib/db/transaction';
import { syncOfflineBatch, type OfflineSyncCommand } from '@/domain/offline/syncOfflineBatch';
import { OFFLINE_SYNC_MAX_COMMANDS } from '@/lib/offline/syncLimits';
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

// Rolled back at the end: sales carry immutable payment allocations and stock
// movements, so a committed batch could never be removed, and every run would
// grow the disposable database and slow the next.
const ROLLBACK = new Error('ROLLBACK_OFFLINE_SYNC_PROBE');

describe('offline sync at the batch limit', () => {
  it('applies every sale inside the route timeout, then deduplicates a replay and reports a conflict', async () => {
    try {
      await withTenant(ctx(), async tx => {
        const started = Date.now();
        const result = await syncOfflineBatch(tx, { companyId: COMPANY, userId, deviceId, commands }, randomUUID());
        const elapsedMs = Date.now() - started;
        console.log(`F-71 offline sync: ${COMMANDS} cash sales applied in ${elapsedMs} ms`);
        expect(result.body).toMatchObject({ synced_count: COMMANDS, applied_count: COMMANDS, conflict_count: 0, status: 'completed' });
        // The route's own transaction has the default 30-second timeout.
        expect(elapsedMs).toBeLessThan(30_000);
        expect(await tx.sale.count({ where: { companyId: COMPANY } })).toBe(COMMANDS);
        const stock = await tx.warehouseStock.findFirstOrThrow({ where: { companyId: COMPANY, warehouseId, productId } });
        expect(stock.qtyOnHand.toFixed(0)).toBe(String(10_000 - COMMANDS));

        // The same batch again: every command a duplicate, nothing posted twice.
        const replay = await syncOfflineBatch(tx, { companyId: COMPANY, userId, deviceId, commands }, randomUUID());
        expect(replay.body).toMatchObject({ synced_count: 0, applied_count: 0, conflict_count: 0 });
        expect(replay.body.results.every((r: { status: string }) => r.status === 'duplicate')).toBe(true);

        // A used sequence number with a different payload: a conflict, reported.
        const payload = { ...commands[0].payload, business_date: new Date(Date.now() + 1000).toISOString() };
        const changed = { ...commands[0], payload, payload_hash: hash(payload) };
        const conflict = await syncOfflineBatch(tx, { companyId: COMPANY, userId, deviceId, commands: [changed] }, randomUUID());
        expect(conflict.body).toMatchObject({ conflict_count: 1, applied_count: 0, status: 'partial' });
        expect(await tx.sale.count({ where: { companyId: COMPANY } })).toBe(COMMANDS);
        throw ROLLBACK;
      }, { timeout: 120_000 });
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }
  }, 180_000);
});
