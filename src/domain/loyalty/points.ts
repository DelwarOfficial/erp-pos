// Reward points.
//
// The owner's rules (2026-11-18):
//   - a registered customer earns 1 point for every full ৳100 actually paid on
//     a sale (the part left owing earns nothing; points spent earn nothing);
//   - a point is worth ৳1 when spent at the till, as a tender, up to the sale;
//   - points lapse 12 months after they were earned;
//   - a void takes the sale's points back and gives back points spent on it;
//     a return takes back the points for the money returned.
//
// Points live in lots: each earn (or give-back) is a positive transaction with
// its own expiry, and spending or lapsing consumes the oldest-expiring lots
// first through reward_point_consumptions, so expiry is exact per lot.
//
// Ledger: a point is a liability from the moment it is earned.
//   earn            Dr Reward points expense    Cr Reward points liability
//   spend (tender)  Dr Reward points liability  (in the sale's own journal)
//   lapse / void    Dr Reward points liability  Cr Reward points expense
// Accounts: the policy's reward expense account (5700 by default) and the
// chart's reward_points_liability account (2500 by default).

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';

export const TAKA_PER_POINT_EARNED = 100;
export const TAKA_PER_POINT_SPENT = 1;
export const POINT_LIFETIME_MONTHS = 12;

type Tx = Prisma.TransactionClient;

export async function loyaltyAccounts(tx: Tx, companyId: string): Promise<{ expense: string; liability: string }> {
  const policy = await tx.accountingPolicy.findUnique({ where: { companyId }, select: { rewardExpenseAccountId: true } });
  const expense = policy?.rewardExpenseAccountId
    ?? (await tx.chartOfAccount.findFirst({ where: { companyId, accountSubtype: 'reward_expense', isActive: true }, select: { id: true } }))?.id;
  const liability = (await tx.chartOfAccount.findFirst({ where: { companyId, accountSubtype: 'reward_points_liability', isActive: true }, select: { id: true } }))?.id;
  if (!expense || !liability) {
    throw new DomainError('VALIDATION_FAILED', 'Add a reward points expense account and a reward points liability account (types reward_expense and reward_points_liability) before using points', {}, 409);
  }
  return { expense, liability };
}

/** Points still spendable in each lot, oldest expiry first. */
async function openLots(tx: Tx, companyId: string, customerId: string, now = new Date()) {
  const lots = await tx.rewardPointTransaction.findMany({
    where: { companyId, customerId, pointsDelta: { gt: 0 }, expiresAt: { gt: now } },
    orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, pointsDelta: true, expiresAt: true, consumptionsAsEarn: { select: { pointsConsumed: true } } },
  });
  return lots.map(l => ({ id: l.id, expiresAt: l.expiresAt!, left: l.pointsDelta - l.consumptionsAsEarn.reduce((t, c) => t + c.pointsConsumed, 0) }))
    .filter(l => l.left > 0);
}

/** Spendable points: open lots, less any points owed back from a reversal that found them already spent. */
export async function pointsBalance(tx: Tx, companyId: string, customerId: string): Promise<number> {
  const open = (await openLots(tx, companyId, customerId)).reduce((t, l) => t + l.left, 0);
  return Math.max(0, open - await owedBack(tx, companyId, customerId));
}

/** Points a reversal took back that had already been spent: they come off future earnings. */
async function owedBack(tx: Tx, companyId: string, customerId: string): Promise<number> {
  const debts = await tx.rewardPointTransaction.findMany({ where: { companyId, customerId, entryType: 'reverse', pointsDelta: { lt: 0 } },
    select: { pointsDelta: true, consumptionsAsConsume: { select: { pointsConsumed: true } } } });
  return debts.reduce((t, d) => t + (-d.pointsDelta - d.consumptionsAsConsume.reduce((s, c) => s + c.pointsConsumed, 0)), 0);
}

/** Take `points` from the oldest-expiring lots for a negative transaction. Returns what could be taken. */
async function consume(tx: Tx, companyId: string, customerId: string, consumeTxnId: string, points: number): Promise<number> {
  let left = points;
  for (const lot of await openLots(tx, companyId, customerId)) {
    if (left <= 0) break;
    const take = Math.min(left, lot.left);
    await tx.rewardPointConsumption.create({ data: { companyId, customerId, earnTransactionId: lot.id, consumeTransactionId: consumeTxnId, pointsConsumed: take } });
    left -= take;
  }
  return points - left;
}

async function journal(tx: Tx, input: { companyId: string; sourceId: string; key: string; points: number; direction: 'earn' | 'release'; memo: string; createdBy: string; branchId?: string }, correlationId: string) {
  if (input.points <= 0) return;
  const { expense, liability } = await loyaltyAccounts(tx, input.companyId);
  const amount = new Prisma.Decimal(input.points).mul(TAKA_PER_POINT_SPENT);
  const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId }, select: { baseCurrencyCode: true } });
  const [dr, cr] = input.direction === 'earn' ? [expense, liability] : [liability, expense];
  await postJournalEntry(tx, {
    companyId: input.companyId, entryDate: new Date(), postingKind: `reward_points_${input.direction}`,
    sourceType: 'reward_points', sourceId: input.sourceId, eventSourceId: `${input.sourceId}:${input.key}`,
    description: input.memo, currencyCode: company.baseCurrencyCode, exchangeRate: 1, createdBy: input.createdBy,
    lines: [{ chartOfAccountId: dr, branchId: input.branchId, debit: amount, credit: 0, memo: input.memo },
      { chartOfAccountId: cr, branchId: input.branchId, debit: 0, credit: amount, memo: input.memo }],
  }, correlationId);
}

const monthsLater = (from: Date, months: number) => { const d = new Date(from); d.setUTCMonth(d.getUTCMonth() + months); return d; };

/** Points earned on a sale: floor(paid ÷ 100). Paid excludes points spent and the part left owing. */
export async function earnPointsForSale(tx: Tx, input: { companyId: string; saleId: string; referenceNo: string; customerId: string; paidAmount: Prisma.Decimal.Value; createdBy: string; branchId: string }, correlationId: string): Promise<number> {
  const points = new Prisma.Decimal(input.paidAmount).div(TAKA_PER_POINT_EARNED).floor().toNumber();
  if (points <= 0) return 0;
  // Without the two points accounts nothing can be booked: the sale goes
  // ahead and earns nothing, rather than the till refusing a paid sale.
  // (Spending points still refuses, in loyaltyAccounts.)
  try { await loyaltyAccounts(tx, input.companyId); }
  catch {
    console.warn(`[loyalty] points not earned on sale ${input.saleId}: reward points accounts are not set up`);
    return 0;
  }
  const owed = await owedBack(tx, input.companyId, input.customerId);
  const earned = await tx.rewardPointTransaction.create({ data: { companyId: input.companyId, customerId: input.customerId, entryType: 'earn',
    pointsDelta: points, saleId: input.saleId, expiresAt: monthsLater(new Date(), POINT_LIFETIME_MONTHS) } });
  // Points owed back from an earlier reversal come off this lot first.
  if (owed > 0) {
    const debts = await tx.rewardPointTransaction.findMany({ where: { companyId: input.companyId, customerId: input.customerId, entryType: 'reverse', pointsDelta: { lt: 0 } },
      orderBy: { createdAt: 'asc' }, select: { id: true, pointsDelta: true, consumptionsAsConsume: { select: { pointsConsumed: true } } } });
    let available = points;
    for (const d of debts) {
      const open = -d.pointsDelta - d.consumptionsAsConsume.reduce((t, c) => t + c.pointsConsumed, 0);
      const take = Math.min(open, available);
      if (take > 0) { await tx.rewardPointConsumption.create({ data: { companyId: input.companyId, customerId: input.customerId, earnTransactionId: earned.id, consumeTransactionId: d.id, pointsConsumed: take } }); available -= take; }
      if (available <= 0) break;
    }
  }
  await journal(tx, { companyId: input.companyId, sourceId: input.saleId, key: 'earn', points, direction: 'earn', memo: `Reward points earned on ${input.referenceNo}`, createdBy: input.createdBy, branchId: input.branchId }, correlationId);
  return points;
}

/** Spend points as a tender on a sale. The sale's own journal debits the liability. */
export async function spendPointsForSale(tx: Tx, input: { companyId: string; saleId: string; customerId: string; points: number }): Promise<void> {
  if (!Number.isInteger(input.points) || input.points <= 0) throw new DomainError('VALIDATION_FAILED', 'Spend a whole number of points', {}, 400);
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${input.customerId} AND company_id = ${input.companyId} FOR UPDATE`;
  const balance = await pointsBalance(tx, input.companyId, input.customerId);
  if (input.points > balance) throw new DomainError('VALIDATION_FAILED', `The customer has ${balance} points, fewer than ${input.points}`, { balance }, 409);
  const spent = await tx.rewardPointTransaction.create({ data: { companyId: input.companyId, customerId: input.customerId, entryType: 'redeem', pointsDelta: -input.points, saleId: input.saleId } });
  await consume(tx, input.companyId, input.customerId, spent.id, input.points);
}

/** Undo a sale's points: take back what it earned (up to `earnedLimit`), give back what it spent. */
export async function reversePointsForSale(tx: Tx, input: { companyId: string; saleId: string; referenceNo: string; createdBy: string; branchId: string; earnedToTakeBack?: number; giveBackSpent: boolean }, correlationId: string): Promise<void> {
  const rows = await tx.rewardPointTransaction.findMany({ where: { companyId: input.companyId, saleId: input.saleId } });
  if (!rows.length) return;
  const customerId = rows[0].customerId;
  const earned = rows.filter(r => r.entryType === 'earn').reduce((t, r) => t + r.pointsDelta, 0);
  const takenBack = -rows.filter(r => r.entryType === 'reverse' && r.pointsDelta < 0).reduce((t, r) => t + r.pointsDelta, 0);
  const take = Math.min(input.earnedToTakeBack ?? earned, earned - takenBack);
  if (take > 0) {
    const back = await tx.rewardPointTransaction.create({ data: { companyId: input.companyId, customerId, entryType: 'reverse', pointsDelta: -take, saleId: input.saleId } });
    // Taken from the lots still open; any already spent stays owed (see owedBack).
    await consume(tx, input.companyId, customerId, back.id, take);
    await journal(tx, { companyId: input.companyId, sourceId: input.saleId, key: `takeback:${back.id}`, points: take, direction: 'release', memo: `Reward points taken back: ${input.referenceNo}`, createdBy: input.createdBy, branchId: input.branchId }, correlationId);
  }
  if (input.giveBackSpent) {
    const spent = -rows.filter(r => r.entryType === 'redeem').reduce((t, r) => t + r.pointsDelta, 0);
    const givenBack = rows.filter(r => r.entryType === 'reverse' && r.pointsDelta > 0).reduce((t, r) => t + r.pointsDelta, 0);
    // The sale journal's reversal restores the liability for points spent; the lot comes back here.
    if (spent - givenBack > 0) await tx.rewardPointTransaction.create({ data: { companyId: input.companyId, customerId, entryType: 'reverse', pointsDelta: spent - givenBack, saleId: input.saleId, expiresAt: monthsLater(new Date(), POINT_LIFETIME_MONTHS) } });
  }
}

/** Lapse lots past their expiry: their unspent points leave the liability. Returns points lapsed. */
export async function expirePoints(tx: Tx, companyId: string, now = new Date(), createdBy?: string, correlationId = randomUUID()): Promise<number> {
  const due = await tx.rewardPointTransaction.findMany({
    where: { companyId, pointsDelta: { gt: 0 }, expiresAt: { lte: now } },
    select: { id: true, customerId: true, pointsDelta: true, consumptionsAsEarn: { select: { pointsConsumed: true } } },
  });
  let lapsed = 0;
  for (const lot of due) {
    const left = lot.pointsDelta - lot.consumptionsAsEarn.reduce((t, c) => t + c.pointsConsumed, 0);
    if (left <= 0) continue;
    const exp = await tx.rewardPointTransaction.create({ data: { companyId, customerId: lot.customerId, entryType: 'expire', pointsDelta: -left } });
    await tx.rewardPointConsumption.create({ data: { companyId, customerId: lot.customerId, earnTransactionId: lot.id, consumeTransactionId: exp.id, pointsConsumed: left } });
    lapsed += left;
  }
  if (lapsed > 0) {
    // A nightly job has no user; the journal records the company's first owner
    // (journal entries must name a real user of the company).
    const actor = createdBy ?? (await tx.user.findFirst({ where: { companyId, isActive: true, roles: { some: { role: { name: 'owner' } } } }, orderBy: { createdAt: 'asc' }, select: { id: true } })
      ?? await tx.user.findFirst({ where: { companyId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
    if (!actor) throw new DomainError('VALIDATION_FAILED', 'No active user to record the points expiry', {}, 409);
    const key = `expiry:${now.toISOString().slice(0, 10)}:${randomUUID().slice(0, 8)}`;
    await journal(tx, { companyId, sourceId: companyId, key, points: lapsed, direction: 'release', memo: `Reward points lapsed (${lapsed})`, createdBy: actor }, correlationId);
  }
  return lapsed;
}
