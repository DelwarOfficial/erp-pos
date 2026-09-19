import { afterAll, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { issueGiftCard, redeemGiftCard } from '@/domain/commands/m6/Loyalty';

const db = new PrismaClient();
afterAll(() => db.$disconnect());

// A ledger-only fix must not turn the accounting gate green. All probe writes
// (including issuance) roll back, even if every assertion eventually passes.
it('gift-card redemption decreases posted GL liability by the exact redeemed amount', async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318'
    || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  const version = await db.$queryRaw<Array<{ version: string }>>`SELECT VERSION() AS version`;
  expect(version[0].version).toMatch(/^11\.8\..*MariaDB/);
  const companyId = '7ff2f39e-a402-4744-adcc-a9e4f2897ef2';
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  expect(company.displayName).toBe('Synthetic Company A');
  const rollback = new Error('ROLLBACK_GIFT_CARD_ACCOUNTING_PROBE');
  let cardId: string | undefined;
  try {
    await db.$transaction(async tx => {
      const user = await tx.user.findFirstOrThrow({ where: { companyId, isActive: true } });
      const branch = await tx.branch.findFirstOrThrow({ where: { companyId, isActive: true } });
      const expense = await tx.chartOfAccount.findFirstOrThrow({ where: { companyId, code: 'giftMarketing' } });
      const policy = await tx.accountingPolicy.findUniqueOrThrow({ where: { companyId } });
      const card = await issueGiftCard(tx, { companyId, branchId: branch.id, issuedBy: user.id,
        faceValue: '100.25', mode: 'promotional', expenseAccountId: expense.id }, randomUUID());
      cardId = card.giftCardId;
      const liability = async () => {
        const totals = await tx.journalLine.aggregate({ where: { companyId,
          chartOfAccountId: policy.giftCardLiabilityAccountId,
          journalEntry: { companyId, sourceType: 'gift_card', sourceId: card.giftCardId,
            status: { in: ['posted', 'reversed'] } },
        }, _sum: { creditBase: true, debitBase: true } });
        return new Prisma.Decimal(totals._sum.creditBase ?? 0).minus(totals._sum.debitBase ?? 0);
      };
      expect((await liability()).eq('100.25')).toBe(true);
      await redeemGiftCard(tx, { companyId, code: card.code, amount: 20, redeemedBy: user.id }, randomUUID());
      const ledger = await tx.giftCardTransaction.aggregate({ where: { companyId, giftCardId: card.giftCardId }, _sum: { amountDelta: true } });
      const gl = await liability();
      console.log('GIFT_CARD_REDEMPTION_ACCOUNTING_PROOF', JSON.stringify({
        issued: '100.25', redeemed: '20.00', ledger: ledger._sum.amountDelta?.toFixed(2),
        postedLiability: gl.toFixed(2), expectedLiability: '80.25', probe: 'transaction-rollback',
      }));
      expect(ledger._sum.amountDelta?.eq('80.25')).toBe(true);
      expect(gl.eq('80.25'), 'STOP: redemption reduced ledger but left posted gift-card liability at 100.25').toBe(true);
      throw rollback;
    }, { timeout: 30000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally {
    if (cardId) expect(await db.giftCard.count({ where: { id: cardId } })).toBe(0);
  }
});
