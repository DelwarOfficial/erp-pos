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
  const companyId = '7ff2f39e-a402-4744-adcc-a9e4f2897ef2';
  await ensureSyntheticIssuerTenant(db, { companyId, label: 'A', code: 'SYN-A' });
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
