import { afterAll, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { redeemGiftCard, issueGiftCard } from '@/domain/commands/m6/Loyalty';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';
const db = new PrismaClient();
afterAll(() => db.$disconnect());

// Diagnostic gate, not an expected-failure test: a failed invariant remains red.
it('resumes at gift-card redemption using the preserved issuance fixture; stops on failure', async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable')
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  const version = await db.$queryRaw<Array<{ version: string }>>`SELECT VERSION() AS version`;
  expect(version[0].version).toMatch(/^11\.8\..*MariaDB/);
  const companyId = '9f1de1c4-52a7-4c8e-9b1d-3f2a5c6d7e81';
  await ensureSyntheticIssuerTenant(db, { companyId, label: 'A', code: 'SYN-RED' });
  // Self-provision the issuance fixture so this suite never depends on another suite having run.
  const tenant = {
    user: await db.user.findFirstOrThrow({ where: { companyId } }),
    expense: await db.chartOfAccount.findFirstOrThrow({ where: { companyId, code: 'giftMarketing' } }),
    branchA: await db.branch.findFirstOrThrow({ where: { companyId, code: 'A' } }),
  };
  await db.$transaction(tx => issueGiftCard(tx, {
    companyId, branchId: tenant.branchA.id,
    faceValue: '100.25', issuedBy: tenant.user.id, mode: 'promotional', expenseAccountId: tenant.expense.id,
  }, randomUUID()), { timeout: 30000 });
  const card = await db.giftCard.findFirstOrThrow({ where: {
    companyId, status: 'active', faceValue: '100.25', transactions: { some: { entryType: 'issue' } },
  }, orderBy: { issuedAt: 'desc' } });
  const rollback = new Error('ROLLBACK_DIAGNOSTIC_ONLY');
  try {
    await db.$transaction(async tx => {
      const before = await tx.giftCardTransaction.aggregate({ where: { giftCardId: card.id, companyId }, _sum: { amountDelta: true } });
      expect(before._sum.amountDelta?.eq('100.25')).toBe(true);
      const result = await redeemGiftCard(tx, { companyId, code: card.code, amount: 20, redeemedBy: card.issuedBy }, randomUUID());
      const changed = await tx.giftCard.findUniqueOrThrow({ where: { id: card.id } });
      const ledger = await tx.giftCardTransaction.findMany({ where: { giftCardId: card.id, companyId } });
      const balance = ledger.reduce((sum, row) => sum.plus(row.amountDelta), new Prisma.Decimal(0));
      const journals = await tx.journalEntry.findMany({ where: { companyId, sourceId: card.id }, include: { lines: true } });
      console.log('NEXT_RELATIONAL_FAILURE_EVIDENCE', JSON.stringify({
        cardId: card.id, returnedBalance: result.remainingBalance, storedFaceValue: changed.faceValue.toFixed(),
        ledgerBalance: balance.toFixed(), redemptionRows: ledger.filter(row => row.entryType === 'redeem').length,
        journalKinds: journals.map(journal => journal.postingKind), rolledBackByHarness: true,
      }));
      expect(balance.eq('80.25'), 'STOP: redemption reports 80.25 but authoritative ledger remains 100.25; missing negative redeem entry').toBe(true);
      expect(changed.faceValue.eq(card.faceValue), 'STOP: issued face value must remain immutable').toBe(true);
      throw rollback;
    }, { timeout: 30000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally {
    expect((await db.giftCard.findUniqueOrThrow({ where: { id: card.id } })).faceValue.eq('100.25')).toBe(true);
  }
}, 60000);

it('redemption ledger chain: 100.25 → redeem 20 → redeem 0.25 = 80.00, immutable faceValue', async () => {
  const companyId = '9f1de1c4-52a7-4c8e-9b1d-3f2a5c6d7e81';
  await ensureSyntheticIssuerTenant(db, { companyId, label: 'A', code: 'SYN-RED' });
  const user = await db.user.findFirstOrThrow({ where: { companyId } });
  const expense = await db.chartOfAccount.findFirstOrThrow({ where: { companyId, code: 'giftMarketing' } });
  const branchA = await db.branch.findFirstOrThrow({ where: { companyId, code: 'A' } });
  const issued = await db.$transaction(tx => issueGiftCard(tx, {
    companyId, branchId: branchA.id, faceValue: '100.25', issuedBy: user.id,
    mode: 'promotional', expenseAccountId: expense.id,
  }, randomUUID()), { timeout: 30000 });
  const balanceOf = async (id: string) => {
    const agg = await db.giftCardTransaction.aggregate({ where: { giftCardId: id }, _sum: { amountDelta: true } });
    return (agg._sum.amountDelta ?? new Prisma.Decimal(0)).toFixed(2);
  };
  expect(await balanceOf(issued.giftCardId)).toBe('100.25');
  await db.$transaction(tx => redeemGiftCard(tx, {
    companyId, code: issued.code, amount: 20, redeemedBy: user.id,
  }, randomUUID()), { timeout: 30000 });
  const afterFirst = await db.giftCard.findUniqueOrThrow({ where: { id: issued.giftCardId } });
  expect(afterFirst.faceValue.eq('100.25')).toBe(true);
  expect(afterFirst.status).toBe('active');
  expect(await balanceOf(issued.giftCardId)).toBe('80.25');
  await db.$transaction(tx => redeemGiftCard(tx, {
    companyId, code: issued.code, amount: 0.25, redeemedBy: user.id,
  }, randomUUID()), { timeout: 30000 });
  expect((await db.giftCard.findUniqueOrThrow({ where: { id: issued.giftCardId } })).faceValue.eq('100.25')).toBe(true);
  expect(await balanceOf(issued.giftCardId)).toBe('80.00');
  const redeemRows = await db.giftCardTransaction.findMany({ where: { giftCardId: issued.giftCardId, entryType: 'redeem' } });
  expect(redeemRows).toHaveLength(2);
  expect(redeemRows.map(row => row.amountDelta.toFixed(2)).sort()).toEqual(['-0.25', '-20.00']);
  const rejects: Array<[number, string]> = [[0, 'zero'], [-5, 'negative'], [80.01, 'over-balance'], [1.999, 'sub-cent']];
  for (const [amount] of rejects) {
    await expect(db.$transaction(tx => redeemGiftCard(tx, {
      companyId, code: issued.code, amount, redeemedBy: user.id,
    }, randomUUID()))).rejects.toThrow();
  }
  expect(await balanceOf(issued.giftCardId)).toBe('80.00');
  // Cross-tenant: foreign company cannot redeem; ledger unchanged.
  await expect(db.$transaction(tx => redeemGiftCard(tx, {
    companyId: '7e05c6d3-ce29-4740-8298-ed2a45ef4d41', code: issued.code, amount: 1, redeemedBy: user.id,
  }, randomUUID()))).rejects.toThrow();
  expect(await balanceOf(issued.giftCardId)).toBe('80.00');
  // Rollback: forced failure AFTER the ledger write leaves zero partial state.
  const rollback = new Error('ROLLBACK_REDEEM_PROBE');
  const beforeRows = await db.giftCardTransaction.count({ where: { giftCardId: issued.giftCardId } });
  try {
    await db.$transaction(async tx => {
      await redeemGiftCard(tx, { companyId, code: issued.code, amount: 10, redeemedBy: user.id }, randomUUID());
      throw rollback;
    }, { timeout: 30000 });
    throw new Error('unexpected commit');
  } catch (error) { if (error !== rollback) throw error; }
  expect(await db.giftCardTransaction.count({ where: { giftCardId: issued.giftCardId } })).toBe(beforeRows);
  expect(await balanceOf(issued.giftCardId)).toBe('80.00');
  expect((await db.giftCard.findUniqueOrThrow({ where: { id: issued.giftCardId } })).status).toBe('active');
}, 120000);

it('concurrent redemptions cannot overspend the ledger balance', async () => {
  const companyId = '9f1de1c4-52a7-4c8e-9b1d-3f2a5c6d7e81';
  const user = await db.user.findFirstOrThrow({ where: { companyId } });
  const expense = await db.chartOfAccount.findFirstOrThrow({ where: { companyId, code: 'giftMarketing' } });
  const branchA = await db.branch.findFirstOrThrow({ where: { companyId, code: 'A' } });
  const issued = await db.$transaction(tx => issueGiftCard(tx, {
    companyId, branchId: branchA.id, faceValue: '50.00', issuedBy: user.id,
    mode: 'promotional', expenseAccountId: expense.id,
  }, randomUUID()), { timeout: 30000 });
  const attempt = (amount: number) => db.$transaction(tx => redeemGiftCard(tx, {
    companyId, code: issued.code, amount, redeemedBy: user.id,
  }, randomUUID()), { timeout: 30000 });
  const results = await Promise.allSettled([attempt(30), attempt(30), attempt(30)]);
  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');
  expect(fulfilled).toHaveLength(1);
  expect(rejected, JSON.stringify(rejected.map(r => String((r as PromiseRejectedResult).reason)))).toHaveLength(2);
  // Losing transactions fail closed: either a domain insufficient-balance rejection or the
  // documented MariaDB ER_CHECKREAD(1020)/conflict exposure (route-level idempotency retries).
  expect(rejected.every(r => {
    const reason = String((r as PromiseRejectedResult).reason);
    return reason.includes('Insufficient balance') || reason.includes('1020') || reason.includes('Record has changed');
  })).toBe(true);
  const agg = await db.giftCardTransaction.aggregate({ where: { giftCardId: issued.giftCardId }, _sum: { amountDelta: true } });
  expect((agg._sum.amountDelta ?? new Prisma.Decimal(0)).toFixed(2)).toBe('20.00');
  const card = await db.giftCard.findUniqueOrThrow({ where: { id: issued.giftCardId } });
  expect(card.faceValue.eq('50.00')).toBe(true);
}, 120000);
