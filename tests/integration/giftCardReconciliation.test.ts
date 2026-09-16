import { afterAll, beforeAll, expect, it } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ALL_CHECKS, checkGiftCardLiability, runReconciliation } from '@/lib/reconciliation/checks';

const db = new PrismaClient();
beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(target.hostname)
      || !target.pathname.endsWith('_disposable')) throw new Error('Local disposable MariaDB required');
  const rows = await db.$queryRaw<Array<{ version: string }>>`SELECT VERSION() AS version`;
  expect(rows[0].version).toMatch(/^11\.8\..*MariaDB/);
});
afterAll(() => db.$disconnect());

async function rollbackTest(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
  const rollback = new Error('ROLLBACK_SYNTHETIC_FIXTURE');
  try {
    await db.$transaction(async tx => { await fn(tx); throw rollback; }, { timeout: 20000 });
    throw new Error('Fixture unexpectedly committed');
  } catch (e) { if (e !== rollback) throw e; }
}
async function fixture(tx: Prisma.TransactionClient) {
  const suffix = randomUUID();
  const company = await tx.company.create({ data: {
    code: 'REC-' + suffix, legalName: 'Synthetic', displayName: 'Synthetic', baseCurrencyCode: 'BDT',
  } });
  const companyId = company.id;
  const user = await tx.user.create({ data: {
    companyId, name: 'Synthetic', email: suffix + '@example.invalid', passwordHash: 'not-a-login',
  } });
  const liability = await tx.chartOfAccount.create({ data: {
    companyId, code: '2100', name: 'Gift liability', accountClass: 'liability',
    accountSubtype: 'current_liability', normalBalance: 'C',
  } });
  const cash = await tx.chartOfAccount.create({ data: {
    companyId, code: '1000', name: 'Synthetic cash', accountClass: 'asset',
    accountSubtype: 'current_asset', normalBalance: 'D',
  } });
  await tx.accountingPolicy.create({ data: {
    companyId, inventoryAccountId: cash.id, cogsAccountId: cash.id, salesRevenueAccountId: cash.id,
    arAccountId: cash.id, apAccountId: liability.id, customerAdvanceAccountId: liability.id,
    supplierAdvanceAccountId: cash.id, purchaseVarianceAccountId: cash.id,
    giftCardLiabilityAccountId: liability.id,
  } });
  const card = await tx.giftCard.create({ data: {
    companyId, code: suffix, faceValue: '999', status: 'active', issuedBy: user.id,
  } });
  await tx.giftCardTransaction.createMany({ data: [
    { companyId, giftCardId: card.id, entryType: 'issue', amountDelta: '100.30', createdBy: user.id },
    { companyId, giftCardId: card.id, entryType: 'redeem', amountDelta: '-20.10', createdBy: user.id },
  ] });
  async function journal(amount: string, status: string = 'posted', reverse = false) {
    const event = await tx.businessEvent.create({ data: {
      companyId, eventType: 'synthetic_reconciliation', sourceType: 'test',
      sourceId: randomUUID(), correlationId: randomUUID(),
    } });
    await tx.journalEntry.create({ data: {
      companyId, eventId: event.id, entryNo: randomUUID(), postingKind: 'test',
      entryDate: new Date(), sourceType: 'test', sourceId: event.id, description: 'Synthetic',
      status, createdBy: user.id, postedBy: user.id, postedAt: new Date(),
      lines: { create: [
        { companyId, lineNo: 1, chartOfAccountId: liability.id,
          creditBase: reverse ? '0' : amount, debitBase: reverse ? amount : '0' },
        { companyId, lineNo: 2, chartOfAccountId: cash.id,
          debitBase: reverse ? '0' : amount, creditBase: reverse ? amount : '0' },
      ] },
    } });
  }
  return { companyId, journal };
}

it('MariaDB: ledger delta authority equals GL; foreign tenant and draft journals excluded', async () => {
  await rollbackTest(async tx => {
    const a = await fixture(tx); const b = await fixture(tx);
    await a.journal('80.20'); await a.journal('500', 'draft'); await b.journal('900');
    expect(await checkGiftCardLiability(tx, a.companyId)).toEqual([]);
  });
});
it('MariaDB: nonzero variance is exact and visible', async () => {
  await rollbackTest(async tx => {
    const a = await fixture(tx); await a.journal('80.21');
    expect(await checkGiftCardLiability(tx, a.companyId)).toMatchObject([{
      expected_value: '80.2', actual_value: '80.21', variance: '0.01', severity: 'high',
    }]);
  });
});
it('MariaDB: reversal preserves original GL contribution plus compensating entry', async () => {
  await rollbackTest(async tx => {
    const a = await fixture(tx);
    await a.journal('100', 'reversed'); await a.journal('100', 'posted', true);
    await a.journal('80.20');
    expect(await checkGiftCardLiability(tx, a.companyId)).toEqual([]);
  });
});
it('MariaDB: missing mapping fails controllably', async () => {
  await rollbackTest(async tx => {
    const a = await fixture(tx);
    await tx.accountingPolicy.deleteMany({ where: { companyId: a.companyId } });
    await expect(checkGiftCardLiability(tx, a.companyId)).rejects.toMatchObject({
      safeCode: 'MISSING_GIFT_CARD_LIABILITY_MAPPING',
    });
  });
});

it('MariaDB: runner persists CHECK_ERROR and failed status after query execution error', async () => {
  const company = await db.company.create({ data: {
    code: 'REC-ERROR-' + randomUUID(), legalName: 'Synthetic', displayName: 'Synthetic', baseCurrencyCode: 'BDT',
  } });
  const original = [...ALL_CHECKS];
  try {
    ALL_CHECKS.splice(0, ALL_CHECKS.length, { code: 'SYNTHETIC_DB_FAILURE', fn: async tx => {
      await tx.$queryRaw`SELECT missing_synthetic_column FROM companies LIMIT 1`;
      return [];
    } });
    const result = await runReconciliation(company.id, 'manual');
    expect(result.status).toBe('failed');
    const persisted = await db.reconciliationRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(persisted.status).toBe('failed');
    expect(JSON.parse(persisted.summary).checks[0]).toMatchObject({ outcome: 'CHECK_ERROR' });
    const findings = await db.reconciliationFinding.findMany({ where: {
      companyId: company.id, reconciliationRunId: result.runId,
    } });
    expect(findings).toHaveLength(1);
    expect(findings[0].details).not.toContain('missing_synthetic_column');
  } finally {
    ALL_CHECKS.splice(0, ALL_CHECKS.length, ...original);
    // Retain synthetic run/finding as evidence in the explicitly disposable database.
  }
});
