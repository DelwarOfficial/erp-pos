// Offline till (disposable MariaDB, rolled back): a cash sale priced from the
// bootstrap's per-quantity line totals (tax included, awkward VAT so rounding
// matters) posts with exactly that total through the sync route's batch; the
// same command sent again is a duplicate and posts nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { syncOfflineBatch } from '@/domain/offline/syncOfflineBatch';
import { priceSaleItem } from '@/domain/tax/priceSaleItem';
import { sumMoney } from '@/lib/offline/posQueue';
import { OFFLINE_MAX_QTY } from '@/lib/offline/syncLimits';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';
import { runInTenantContext } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = 'c5d7e8f9-0a12-4c67-f890-b4c5d6e7f80a';
const ROLLBACK = new Error('ROLLBACK_OFFLINE_TILL');
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'OT', code: 'SYN-OT' });
}, 120_000);
afterAll(() => db.$disconnect());

async function probe(body: (tx: Prisma.TransactionClient) => Promise<void>) {
  const ctx = { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, correlationId: randomUUID(), requestId: randomUUID() } as never;
  try { await runInTenantContext(ctx, () => db.$transaction(async tx => { await body(tx); throw ROLLBACK; }, { timeout: 60_000 })); }
  catch (error) { if (error !== ROLLBACK) throw error; }
}

describe('offline till', () => {
  it('posts a queued cash sale at exactly the total the till showed, once', async () => {
    await probe(async tx => {
      const branch = fx.branches[0];
      const warehouse = await tx.warehouse.findFirst({ where: { companyId: COMPANY_ID, branchId: branch.id } })
        ?? await tx.warehouse.create({ data: { companyId: COMPANY_ID, branchId: branch.id, code: 'WH-OT', name: 'OT', isActive: true } });
      const unit = await tx.unit.findFirst({ where: { companyId: COMPANY_ID } }) ?? await tx.unit.create({ data: { companyId: COMPANY_ID, code: 'pc', name: 'Piece' } });
      const category = await tx.category.findFirst({ where: { companyId: COMPANY_ID } }) ?? await tx.category.create({ data: { companyId: COMPANY_ID, code: 'gen', name: 'General' } });
      const acc = (code: string, cls: 'asset' | 'liability') => tx.chartOfAccount.create({ data: { companyId: COMPANY_ID, code: `${code}-${randomUUID().slice(0, 6)}`, name: code,
        accountClass: cls, accountSubtype: cls === 'asset' ? 'vat_input' : 'vat_output', normalBalance: cls === 'asset' ? 'D' : 'C', isActive: true } });
      const component = await tx.taxComponent.create({ data: { companyId: COMPANY_ID, componentCode: `VAT-${randomUUID().slice(0, 4)}`, name: 'VAT 7.5', rate: '7.5',
        effectiveFrom: new Date('2020-01-01'), inputAccountId: (await acc('vin', 'asset')).id, outputAccountId: (await acc('vout', 'liability')).id } });
      const taxCode = await tx.taxCode.create({ data: { companyId: COMPANY_ID, code: `V75-${randomUUID().slice(0, 4)}`, name: 'VAT 7.5', effectiveFrom: new Date('2020-01-01'),
        components: { create: { taxComponentId: component.id } } } });
      const product = await tx.product.create({ data: { companyId: COMPANY_ID, code: `OT-${randomUUID().slice(0, 8)}`, name: 'Charger', productType: 'standard',
        unitId: unit.id, categoryId: category.id, defaultPrice: '333.33', referenceCost: 200, isActive: true, defaultTaxCodeId: taxCode.id } });
      await tx.warehouseStock.create({ data: { companyId: COMPANY_ID, warehouseId: warehouse.id, productId: product.id, qtyOnHand: 50, movingAverageCost: 200 } });
      const device = await tx.device.create({ data: { companyId: COMPANY_ID, branchId: branch.id, label: 'Till 1', devicePublicKey: randomUUID(), registeredBy: fx.user.id, status: 'active' } });

      // What the bootstrap hands the till: the server's total for each quantity.
      const priced = await tx.product.findUniqueOrThrow({ where: { id: product.id }, include: { defaultTaxCode: { include: { components: { include: { taxComponent: true } } } } } });
      const lineTotals = Array.from({ length: OFFLINE_MAX_QTY }, (_, i) => new Prisma.Decimal(priceSaleItem(priced, { qty: i + 1, unitPrice: 333.33 }, new Date()).lineTotal).toString());
      expect(lineTotals[0]).toBe('358.32975'); // 333.33 + 7.5% VAT, unrounded as posting keeps it
      const total = sumMoney([lineTotals[2], lineTotals[6]]); // a line of 3 and a line of 7

      const payload = { cashier_id: fx.user.id, branch_id: branch.id, warehouse_id: warehouse.id, currency_code: 'BDT', exchange_rate: 1, business_date: new Date().toISOString(),
        items: [{ product_id: product.id, qty: 3, unit_price: 333.33 }, { product_id: product.id, qty: 7, unit_price: 333.33 }],
        payments: [{ payment_method: 'cash', amount: Number(total), financial_account_id: fx.cash.id }] };
      const command = { command_type: 'cash_sale', sequence_number: 1, payload, payload_hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'), idempotency_key: `offline-${device.id}-1` };
      const first = await syncOfflineBatch(tx, { companyId: COMPANY_ID, userId: fx.user.id, deviceId: device.id, commands: [command] }, randomUUID());
      expect(first.body.results[0].status).toBe('applied');
      const sale = await tx.sale.findUniqueOrThrow({ where: { id: first.body.results[0].resource_id! } });
      expect(new Prisma.Decimal(sale.grandTotal).toFixed(2)).toBe(new Prisma.Decimal(total).toFixed(2));

      const again = await syncOfflineBatch(tx, { companyId: COMPANY_ID, userId: fx.user.id, deviceId: device.id, commands: [command] }, randomUUID());
      expect(again.body.results[0].status).toBe('duplicate');
      expect(await tx.sale.count({ where: { companyId: COMPANY_ID, id: sale.id } })).toBe(1);
      expect(await tx.offlineCommand.count({ where: { deviceId: device.id } })).toBe(1);

      // Cash taken at branch A cannot be put in branch B's drawer (online or offline).
      const otherDrawer = await tx.financialAccount.create({ data: { companyId: COMPANY_ID, branchId: fx.branches[1].id, name: `B drawer ${randomUUID().slice(0, 4)}`,
        accountType: 'cash', currencyCode: 'BDT', isActive: true,
        chartOfAccountId: (await tx.chartOfAccount.create({ data: { companyId: COMPANY_ID, code: `CB-${randomUUID().slice(0, 6)}`, name: 'B drawer',
          accountClass: 'asset', accountSubtype: 'cash', normalBalance: 'D', isActive: true } })).id } });
      const wrong = { ...payload, payments: [{ ...payload.payments[0], financial_account_id: otherDrawer.id }] };
      await expect(syncOfflineBatch(tx, { companyId: COMPANY_ID, userId: fx.user.id, deviceId: device.id, commands: [{ ...command, sequence_number: 2, payload: wrong,
        payload_hash: createHash('sha256').update(JSON.stringify(wrong)).digest('hex'), idempotency_key: `offline-${device.id}-2` }] }, randomUUID()))
        .rejects.toThrow(/belongs to another branch/);

      // Attribution: a sale taken by someone else is not credited to whoever syncs it.
      const cashier = await tx.user.create({ data: { companyId: COMPANY_ID, name: 'Shirin', email: `${randomUUID()}@example.invalid`, passwordHash: 'not-a-login', accessScope: 'multi_branch' } });
      const theirs = { ...payload, cashier_id: cashier.id, business_date: new Date().toISOString() };
      const cmd = (n: number, body = theirs) => ({ command_type: 'cash_sale', sequence_number: n, payload: body,
        payload_hash: createHash('sha256').update(JSON.stringify(body)).digest('hex'), idempotency_key: `offline-${device.id}-${n}` });
      await expect(syncOfflineBatch(tx, { companyId: COMPANY_ID, userId: fx.user.id, deviceId: device.id, commands: [cmd(3)] }, randomUUID()))
        .rejects.toThrow(/Another cashier took this offline sale/);
      // A manager cannot take it over while that cashier can still sign in...
      await expect(syncOfflineBatch(tx, { companyId: COMPANY_ID, userId: fx.user.id, deviceId: device.id, commands: [cmd(3)], adoptReason: 'Shirin left early' }, randomUUID()))
        .rejects.toThrow(/Shirin can still sign in/);
      // ...but can once the account is deactivated; the audit log keeps both people.
      await tx.user.update({ where: { id: cashier.id }, data: { isActive: false } });
      const adopted = await syncOfflineBatch(tx, { companyId: COMPANY_ID, userId: fx.user.id, deviceId: device.id, commands: [cmd(3)], adoptReason: 'Shirin left the company' }, randomUUID());
      expect(adopted.body.results[0].status).toBe('applied');
      const adoptedSale = await tx.sale.findUniqueOrThrow({ where: { id: adopted.body.results[0].resource_id! } });
      expect(adoptedSale.billerId).toBe(fx.user.id);
      const audit = await tx.auditLog.findFirstOrThrow({ where: { companyId: COMPANY_ID, action: 'offline.sale_posted_by_manager', entityId: adoptedSale.id } });
      expect(JSON.parse(audit.afterValue!)).toMatchObject({ original_cashier_id: cashier.id, original_cashier_name: 'Shirin', posted_by: fx.user.id, reason: 'Shirin left the company' });

      // A revoked till can send nothing more.
      await tx.device.update({ where: { id: device.id }, data: { status: 'revoked', revokedAt: new Date() } });
      const mineAgain = { ...payload, business_date: new Date().toISOString() };
      await expect(syncOfflineBatch(tx, { companyId: COMPANY_ID, userId: fx.user.id, deviceId: device.id, commands: [cmd(4, mineAgain)] }, randomUUID()))
        .rejects.toThrow(/not found or revoked/);
    });
  });
});
