// src/domain/commands/m6/Loyalty.ts
// Gift card + coupon + reward point commands per §5.13 + §20.D17.
// IssueGiftCard, RedeemGiftCard, PostGiftCardRefund, RedeemCoupon, EarnRewardPoints, RedeemRewardPoints.

import { Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { nextDocumentNumber } from '@/lib/numbering';

export type GiftCardFunding =
  | { mode: 'sold'; financialAccountId: string; cashReceived: true }
  | { mode: 'promotional'; expenseAccountId: string };

// ── IssueGiftCard ──
export async function issueGiftCard(
  tx: Prisma.TransactionClient,
  params: { companyId: string; branchId: string; faceValue: string; expiresAt?: Date; issuedBy: string } & GiftCardFunding,
  correlationId: string,
): Promise<{ giftCardId: string; code: string; faceValue: string; journalEntryId: string; paymentId: string | null }> {
  // The gift-card subledger has no currency dimension: issue in company base currency only.
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(params.faceValue) || !new Prisma.Decimal(params.faceValue).gt(0)) {
    throw new DomainError('VALIDATION_FAILED', 'Positive amount with at most 12 integer and 2 decimal digits required', {}, 400);
  }
  const amount = new Prisma.Decimal(params.faceValue);
  const now = new Date();
  if (params.expiresAt && (!Number.isFinite(params.expiresAt.getTime()) || params.expiresAt <= now)) {
    throw new DomainError('VALIDATION_FAILED', 'Expiry must be in the future', {}, 400);
  }
  const company = await tx.company.findFirst({ where: { id: params.companyId, status: 'active' } });
  const branch = await tx.branch.findFirst({ where: { id: params.branchId, companyId: params.companyId, isActive: true } });
  const issuer = await tx.user.findFirst({ where: { id: params.issuedBy, companyId: params.companyId, isActive: true, deletedAt: null } });
  if (!company || !branch || !issuer) throw new DomainError('VALIDATION_FAILED', 'Invalid issuance company, branch or issuer', {}, 400);
  const policy = await tx.accountingPolicy.findUnique({ where: { companyId: params.companyId } });
  const liability = policy && await tx.chartOfAccount.findFirst({ where: {
    id: policy.giftCardLiabilityAccountId, companyId: params.companyId, isActive: true,
    accountClass: 'liability', normalBalance: 'C',
  } });
  if (!liability) throw new DomainError('VALIDATION_FAILED', 'Active gift-card liability mapping required', {}, 409);

  let debitAccountId: string;
  let financialAccountId: string | undefined;
  if (params.mode === 'sold') {
    if (params.cashReceived !== true) throw new DomainError('VALIDATION_FAILED', 'Cash receipt confirmation required', {}, 400);
    const funding = await tx.financialAccount.findFirst({ where: {
      id: params.financialAccountId, companyId: params.companyId, branchId: params.branchId,
      isActive: true, accountType: 'cash', currencyCode: company.baseCurrencyCode,
    } });
    const cash = funding && await tx.chartOfAccount.findFirst({ where: {
      id: funding.chartOfAccountId, companyId: params.companyId, isActive: true, accountClass: 'asset', normalBalance: 'D',
    } });
    if (!funding || !cash) throw new DomainError('VALIDATION_FAILED', 'Active branch cash account in company base currency required', {}, 400);
    debitAccountId = cash.id;
    financialAccountId = funding.id;
  } else if (params.mode === 'promotional') {
    const expense = await tx.chartOfAccount.findFirst({ where: {
      id: params.expenseAccountId, companyId: params.companyId, isActive: true,
      accountClass: 'expense', normalBalance: 'D', allowManualPosting: true, isControlAccount: false,
    } });
    if (!expense) throw new DomainError('VALIDATION_FAILED', 'Active manually postable marketing expense account required', {}, 400);
    debitAccountId = expense.id;
  } else {
    throw new DomainError('VALIDATION_FAILED', 'Explicit issuance mode required', {}, 400);
  }
  const code = 'GC-' + randomBytes(8).toString('hex').toUpperCase();
  const card = await tx.giftCard.create({
    data: { companyId: params.companyId, code, faceValue: amount,
      status: 'active', expiresAt: params.expiresAt ?? null, issuedBy: params.issuedBy },
  });
  let paymentId: string | null = null;
  if (financialAccountId) {
    const { documentNumber } = await nextDocumentNumber(tx, {
      companyId: params.companyId, documentType: 'PAYMENT', fiscalYear: now.getFullYear(), prefix: 'PAY-',
    });
    const payment = await tx.payment.create({ data: {
      companyId: params.companyId, branchId: params.branchId, referenceNo: documentNumber,
      clientTxnId: card.id, paymentType: 'other', direction: 'incoming', financialAccountId,
      currencyCode: company.baseCurrencyCode, exchangeRate: '1', amount, baseAmount: amount,
      paymentMethod: 'cash', methodReference: card.id, paymentStatus: 'posted',
      businessDate: now, receivedOrPaidAt: now, postedAt: now, createdBy: params.issuedBy,
      notes: `Gift-card issuance ${card.id}`,
    } });
    paymentId = payment.id;
  }
  const journal = await postJournalEntry(tx, {
    companyId: params.companyId, entryDate: now, postingKind: 'gift_card_issue',
    sourceType: 'gift_card', sourceId: card.id, description: `Gift card ${params.mode}: ${code}`,
    currencyCode: company.baseCurrencyCode, exchangeRate: 1, createdBy: params.issuedBy,
    lines: [
      { chartOfAccountId: debitAccountId, branchId: params.branchId, financialAccountId, debit: amount, credit: '0' },
      { chartOfAccountId: liability.id, branchId: params.branchId, debit: '0', credit: amount },
    ],
  }, correlationId);
  const entry = await tx.journalEntry.findFirstOrThrow({
    where: { id: journal.journalEntryId, companyId: params.companyId }, select: { eventId: true },
  });
  await tx.giftCardTransaction.create({ data: {
    companyId: params.companyId, giftCardId: card.id, entryType: 'issue', amountDelta: amount,
    eventId: entry.eventId, createdBy: params.issuedBy,
  } });
  await tx.auditLog.create({
    data: { companyId: params.companyId, userId: params.issuedBy, correlationId,
      action: 'gift_card.issue', entityType: 'gift_card', entityId: card.id,
      afterValue: JSON.stringify({ code, face_value: amount.toFixed(2), mode: params.mode,
        branch_id: params.branchId, debit_account_id: debitAccountId,
        journal_entry_id: journal.journalEntryId, payment_id: paymentId }) },
  });
  return { giftCardId: card.id, code, faceValue: amount.toFixed(2), journalEntryId: journal.journalEntryId, paymentId };
}

// ── RedeemGiftCard ──
// Blueprint: gift-card balance is SUM(gift_card_transactions.amount_delta); the GiftCard
// master row carries no balance and face_value stays immutable after issuance.
// Redemption locks the card row (§13.2) and appends a negative 'redeem' ledger entry.
export async function redeemGiftCard(
  tx: Prisma.TransactionClient,
  params: { companyId: string; code: string; amount: number; redeemedBy: string },
  correlationId: string,
): Promise<{ giftCardId: string; remainingBalance: number; status: string }> {
  if (!Number.isFinite(params.amount)) {
    throw new DomainError('VALIDATION_FAILED', 'Redemption amount must be a finite number', {}, 400);
  }
  const amount = new Prisma.Decimal(params.amount);
  if (amount.lte(0) || amount.dp() > 2) {
    throw new DomainError('VALIDATION_FAILED', 'Positive amount with at most 2 decimal places required', {}, 400);
  }
  const card = await tx.giftCard.findFirst({ where: { companyId: params.companyId, code: params.code } });
  if (!card || card.status !== 'active') {
    throw new DomainError('GIFT_CARD_EXPIRED', 'Gift card not found or not active', {}, 404);
  }
  if (card.expiresAt && card.expiresAt < new Date()) {
    throw new DomainError('GIFT_CARD_EXPIRED', 'Gift card has expired', {}, 409);
  }
  // Redemption locks the card row AND reads the ledger with a locking SUM:
  // under REPEATABLE READ a plain aggregate would return the pre-lock snapshot
  // and allow concurrent redemptions to overspend (§13.2 ledger balance lock).
  await tx.$queryRaw`SELECT id FROM gift_cards WHERE id = ${card.id} FOR UPDATE`;
  const ledgerRows = await tx.$queryRaw<Array<{ total: string | null }>>`
    SELECT COALESCE(SUM(amount_delta), 0) AS total FROM gift_card_transactions
    WHERE gift_card_id = ${card.id} FOR UPDATE`;
  const balance = new Prisma.Decimal(ledgerRows[0]?.total ?? 0);
  if (amount.gt(balance)) {
    throw new DomainError('GIFT_CARD_INSUFFICIENT', `Insufficient balance: ${balance.toFixed(2)} < ${amount.toFixed(2)}`, {}, 409);
  }
  const remaining = balance.minus(amount);

  // Redemption extinguishes part of the liability that issuance recognised.
  // Without this posting the ledger fell while the GL liability stayed at the
  // full face value, so the liability was overstated by every redemption.
  //
  //   Dr Gift-card liability   amount
  //     Cr Sales revenue       amount
  //
  // This command has no sale context -- POS gift-card tender is rejected in
  // PostSale -- so the settlement is recognised as revenue. When gift-card
  // tender is enabled, redemption must instead settle against that sale and
  // this credit moves to the sale's own revenue posting.
  const policy = await tx.accountingPolicy.findUnique({ where: { companyId: params.companyId } });
  const liabilityAccount = policy && await tx.chartOfAccount.findFirst({
    where: {
      id: policy.giftCardLiabilityAccountId, companyId: params.companyId, isActive: true,
      accountClass: 'liability', normalBalance: 'C',
    },
  });
  if (!policy || !liabilityAccount) {
    throw new DomainError('VALIDATION_FAILED', 'Active gift-card liability mapping required', {}, 409);
  }
  // Both sides of this entry come from the accounting policy, which does not
  // currently enforce that distinct roles map to distinct accounts. If they are
  // the same account the entry nets to zero and the liability is never
  // extinguished, which is silently wrong -- so refuse rather than post it.
  if (policy.salesRevenueAccountId === policy.giftCardLiabilityAccountId) {
    throw new DomainError('VALIDATION_FAILED',
      'Accounting policy maps gift-card liability and sales revenue to the same account; redemption cannot be posted',
      { account_id: policy.giftCardLiabilityAccountId }, 409);
  }

  const event = await tx.businessEvent.create({ data: {
    companyId: params.companyId, eventType: 'gift_card.redeemed', sourceType: 'gift_card_redeem',
    sourceId: randomUUID(), correlationId,
  } });

  await postJournalEntry(tx, {
    companyId: params.companyId,
    entryDate: new Date(),
    postingKind: 'gift_card_redeem',
    // The journal points at the card; the event is keyed per redemption, since
    // one card is redeemed many times and issuance already holds (gift_card, card.id).
    sourceType: 'gift_card', sourceId: card.id, eventSourceId: `${card.id}:redeem:${event.id}`,
    description: `Gift card redeemed: ${card.code}`,
    currencyCode: 'BDT',
    exchangeRate: 1,
    createdBy: params.redeemedBy,
    lines: [
      { chartOfAccountId: liabilityAccount.id, debit: amount, credit: 0, memo: `Gift card redemption ${card.code}` },
      { chartOfAccountId: policy.salesRevenueAccountId, debit: 0, credit: amount, memo: `Gift card settlement ${card.code}` },
    ],
  }, correlationId);
  await tx.giftCardTransaction.create({ data: {
    companyId: params.companyId, giftCardId: card.id, entryType: 'redeem',
    amountDelta: amount.negated(), eventId: event.id, createdBy: params.redeemedBy,
  } });
  await tx.giftCard.update({ where: { id: card.id }, data: { status: remaining.eq(0) ? 'redeemed' : 'active' } });
  await tx.auditLog.create({
    data: { companyId: params.companyId, userId: params.redeemedBy, correlationId,
      action: 'gift_card.redeem', entityType: 'gift_card', entityId: card.id,
      afterValue: JSON.stringify({ amount: amount.toFixed(2), ledger_balance_before: balance.toFixed(2), remaining: remaining.toFixed(2) }) },
  });
  return { giftCardId: card.id, remainingBalance: remaining.toNumber(), status: remaining.eq(0) ? 'redeemed' : 'active' };
}

// ── PostGiftCardRefund ──
// Same ledger authority: a refund appends a positive 'refund' entry referencing the
// originating sale return (§7.6/§20.D17); face_value stays immutable. The liability
// journal reversal is posted by the sale-return accounting layer.
export async function postGiftCardRefund(
  tx: Prisma.TransactionClient,
  params: { companyId: string; giftCardId: string; saleReturnId: string; amount: number; refundedBy: string },
  correlationId: string,
): Promise<{ giftCardId: string; newBalance: number }> {
  if (!Number.isFinite(params.amount)) {
    throw new DomainError('VALIDATION_FAILED', 'Refund amount must be a finite number', {}, 400);
  }
  const amount = new Prisma.Decimal(params.amount);
  if (amount.lte(0) || amount.dp() > 2) {
    throw new DomainError('VALIDATION_FAILED', 'Positive amount with at most 2 decimal places required', {}, 400);
  }
  const saleReturn = await tx.saleReturn.findFirst({ where: { id: params.saleReturnId, companyId: params.companyId } });
  if (!saleReturn) {
    throw new DomainError('VALIDATION_FAILED', 'Valid sale return required for gift-card refund', {}, 400);
  }
  const card = await tx.giftCard.findFirst({ where: { id: params.giftCardId, companyId: params.companyId } });
  if (!card) throw new DomainError('RESOURCE_NOT_FOUND', 'Gift card not found', {}, 404);
  await tx.$queryRaw`SELECT id FROM gift_cards WHERE id = ${card.id} FOR UPDATE`;
  const ledgerRows = await tx.$queryRaw<Array<{ total: string | null }>>`
    SELECT COALESCE(SUM(amount_delta), 0) AS total FROM gift_card_transactions
    WHERE gift_card_id = ${card.id} FOR UPDATE`;
  const balance = new Prisma.Decimal(ledgerRows[0]?.total ?? 0);
  const newBalance = balance.plus(amount);
  const event = await tx.businessEvent.create({ data: {
    companyId: params.companyId, eventType: 'gift_card.refunded', sourceType: 'gift_card_refund',
    sourceId: randomUUID(), correlationId,
  } });
  await tx.giftCardTransaction.create({ data: {
    companyId: params.companyId, giftCardId: card.id, entryType: 'refund',
    amountDelta: amount, saleReturnId: saleReturn.id, eventId: event.id, createdBy: params.refundedBy,
  } });
  await tx.giftCard.update({ where: { id: card.id }, data: { status: 'active' } });
  await tx.auditLog.create({
    data: { companyId: params.companyId, userId: params.refundedBy, correlationId,
      action: 'gift_card.refund', entityType: 'gift_card', entityId: card.id,
      afterValue: JSON.stringify({ sale_return_id: params.saleReturnId, refund_amount: amount.toFixed(2), new_balance: newBalance.toFixed(2) }) },
  });
  return { giftCardId: card.id, newBalance: newBalance.toNumber() };
}

// ── RedeemCoupon ── (simplified — no coupon model in schema yet; returns validation result)
export async function redeemCoupon(
  tx: Prisma.TransactionClient,
  params: { companyId: string; couponCode: string; saleId: string; redeemedBy: string },
  correlationId: string,
): Promise<{ valid: boolean; discountAmount: number }> {
  // Coupon model not yet in schema — return invalid for now
  // TODO: add Coupons + CouponRedemptions models to schema
  await tx.auditLog.create({
    data: { companyId: params.companyId, userId: params.redeemedBy, correlationId,
      action: 'coupon.redeem_attempt', entityType: 'sale', entityId: params.saleId,
      afterValue: JSON.stringify({ coupon_code: params.couponCode, valid: false }) },
  });
  return { valid: false, discountAmount: 0 };
}

// ── EarnRewardPoints ── (simplified — no reward_points model yet)
export async function earnRewardPoints(
  tx: Prisma.TransactionClient,
  params: { companyId: string; customerId: string; saleId: string; saleAmount: number; earnedBy: string },
  correlationId: string,
): Promise<{ pointsEarned: number }> {
  // 1 point per 100 BDT spent (configurable — hardcoded for now)
  const points = Math.floor(params.saleAmount / 100);
  // TODO: create RewardPointTransaction when model is added
  await tx.auditLog.create({
    data: { companyId: params.companyId, userId: params.earnedBy, correlationId,
      action: 'reward_points.earn', entityType: 'sale', entityId: params.saleId,
      afterValue: JSON.stringify({ customer_id: params.customerId, points, sale_amount: params.saleAmount }) },
  });
  return { pointsEarned: points };
}

// ── RedeemRewardPoints ── (simplified)
export async function redeemRewardPoints(
  tx: Prisma.TransactionClient,
  params: { companyId: string; customerId: string; points: number; saleId: string; redeemedBy: string },
  correlationId: string,
): Promise<{ pointsRedeemed: number; discountAmount: number }> {
  // 1 point = 1 BDT (configurable)
  const discount = params.points;
  // TODO: create RewardPointConsumption when model is added
  await tx.auditLog.create({
    data: { companyId: params.companyId, userId: params.redeemedBy, correlationId,
      action: 'reward_points.redeem', entityType: 'sale', entityId: params.saleId,
      afterValue: JSON.stringify({ customer_id: params.customerId, points: params.points, discount }) },
  });
  return { pointsRedeemed: params.points, discountAmount: discount };
}
