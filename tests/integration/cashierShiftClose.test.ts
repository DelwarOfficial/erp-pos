// F-27 / F-28: a shift's expected cash nets payouts from the drawer, and a
// counted variance is posted to the ledger (disposable MariaDB).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { withTenant } from '@/lib/db/transaction';
import { closeCashierShift, openCashierShift } from '@/domain/commands/m3/CashierShift';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const A: string = randomUUID();
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let warehouseId: string;
const ctx = () => ({ companyId: A, branchIds: [], allBranches: true, isGlobal: false, userId: undefined, correlationId: randomUUID(), requestId: randomUUID() }) as never;

async function open(float: number) {
  const cashier = await db.user.create({ data: { companyId: A, name: 'Cashier', email: `${randomUUID()}@example.invalid`, passwordHash: 'x' } });
  return withTenant(ctx(), tx => openCashierShift(tx, {
    companyId: A, branchId: fx.branches[0].id, warehouseId, cashierId: cashier.id, cashAccountId: fx.cash.id, openingFloat: float,
  }, randomUUID()));
}
async function cash(shiftId: string, amount: string, direction: 'incoming' | 'outgoing', status = 'posted') {
  return db.payment.create({ data: {
    companyId: A, branchId: fx.branches[0].id, referenceNo: `T-${randomUUID().slice(0, 8)}`, clientTxnId: randomUUID(),
    paymentType: direction === 'incoming' ? 'sale_receipt' : 'sale_refund', direction, financialAccountId: fx.cash.id,
    cashierShiftId: shiftId, amount, baseAmount: amount, paymentMethod: 'cash', paymentStatus: status,
    businessDate: new Date(), createdBy: fx.user.id,
  } });
}
const close = (shiftId: string, counted: number) => withTenant(ctx(), tx => closeCashierShift(tx, {
  shiftId, companyId: A, closedBy: fx.user.id, countedClosingCash: counted, varianceReason: 'count', approvedBy: fx.user.id,
}, randomUUID()));

beforeAll(async () => {
  fx = await ensureSyntheticIssuerTenant(db, { companyId: A, label: 'CS', code: `SYN-CS-${A.slice(0, 8)}` });
  warehouseId = (await db.warehouse.create({ data: { companyId: A, branchId: fx.branches[0].id, name: 'CS', code: 'CS' } })).id;
}, 120_000);
afterAll(() => db.$disconnect());

describe('closing a cashier shift', () => {
  it('subtracts cash paid out, nets a reversed payment, and posts a shortage (F-27, F-28)', async () => {
    const shift = await open(1000);
    await cash(shift.shiftId, '500.00', 'incoming');
    await cash(shift.shiftId, '200.00', 'outgoing'); // a cash refund from the drawer
    await cash(shift.shiftId, '300.00', 'incoming', 'reversed'); // taken in, then reversed...
    await cash(shift.shiftId, '300.00', 'outgoing'); // ...by its reversal
    await cash(shift.shiftId, '999.00', 'incoming', 'failed'); // never happened

    const result = await close(shift.shiftId, 1249.5);
    expect(result).toMatchObject({ expectedCash: 1300, countedCash: 1249.5, variance: -50.5 });

    const entry = await db.journalEntry.findFirstOrThrow({ where: { companyId: A, sourceType: 'cashier_shift', sourceId: shift.shiftId }, include: { lines: true } });
    const policy = await db.accountingPolicy.findUniqueOrThrow({ where: { companyId: A } });
    const line = (accountId: string) => entry.lines.find(l => l.chartOfAccountId === accountId)!;
    expect(new Prisma.Decimal(line(policy.cashOverShortAccountId!).debitBase).toFixed(2)).toBe('50.50');
    expect(new Prisma.Decimal(line(fx.cash.chartOfAccountId).creditBase).toFixed(2)).toBe('50.50');
  });

  it('posts an overage the other way, and nothing when the count matches', async () => {
    const over = await open(100);
    await close(over.shiftId, 120);
    const entry = await db.journalEntry.findFirstOrThrow({ where: { companyId: A, sourceType: 'cashier_shift', sourceId: over.shiftId }, include: { lines: true } });
    expect(new Prisma.Decimal(entry.lines.find(l => l.chartOfAccountId === fx.cash.chartOfAccountId)!.debitBase).toFixed(2)).toBe('20.00');

    const exact = await open(100);
    await cash(exact.shiftId, '40.00', 'outgoing');
    expect((await close(exact.shiftId, 60)).variance).toBe(0);
    expect(await db.journalEntry.count({ where: { companyId: A, sourceType: 'cashier_shift', sourceId: exact.shiftId } })).toBe(0);
  });

  it('refuses a variance when no cash over/short account is set', async () => {
    const shift = await open(100);
    await db.accountingPolicy.update({ where: { companyId: A }, data: { cashOverShortAccountId: null } });
    try {
      await expect(close(shift.shiftId, 90)).rejects.toThrow(/cash over\/short account/);
    } finally {
      const account = await db.chartOfAccount.findFirstOrThrow({ where: { companyId: A, code: 'cashOverShort' } });
      await db.accountingPolicy.update({ where: { companyId: A }, data: { cashOverShortAccountId: account.id } });
    }
  });
});
