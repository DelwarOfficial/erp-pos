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
export async function redeemGiftCard(
  tx: Prisma.TransactionClient,
  params: { companyId: string; code: string; amount: number; redeemedBy: string },
  correlationId: string,
): Promise<{ giftCardId: string; remainingBalance: number; status: string }> {
  const card = await tx.giftCard.findFirst({
    where: { companyId: params.companyId, code: params.code, status: 'active' },
  });
  if (!card) throw new DomainError('GIFT_CARD_EXPIRED', 'Gift card not found or not active', {}, 404);
  if (card.expiresAt && card.expiresAt < new Date()) {
    throw new DomainError('GIFT_CARD_EXPIRED', 'Gift card has expired', {}, 409);
  }
  const faceValue = parseFloat(card.faceValue.toString());
  if (params.amount > faceValue) {
    throw new DomainError('GIFT_CARD_INSUFFICIENT', `Insufficient balance: ${faceValue} < ${params.amount}`, {}, 409);
  }
  const remaining = faceValue - params.amount;
  const newStatus = remaining <= 0 ? 'redeemed' : 'active';
  await tx.giftCard.update({
    where: { id: card.id },
    data: { faceValue: remaining, status: newStatus },
  });
  await tx.auditLog.create({
    data: { companyId: params.companyId, userId: params.redeemedBy, correlationId,
      action: 'gift_card.redeem', entityType: 'gift_card', entityId: card.id,
      afterValue: JSON.stringify({ amount: params.amount, remaining }) },
  });
  return { giftCardId: card.id, remainingBalance: remaining, status: newStatus };
}

// ── PostGiftCardRefund ──
export async function postGiftCardRefund(
  tx: Prisma.TransactionClient,
  params: { companyId: string; giftCardId: string; saleReturnId: string; amount: number; refundedBy: string },
  correlationId: string,
): Promise<{ giftCardId: string; newBalance: number }> {
  const card = await tx.giftCard.findFirst({ where: { id: params.giftCardId, companyId: params.companyId } });
  if (!card) throw new DomainError('RESOURCE_NOT_FOUND', 'Gift card not found', {}, 404);
  const currentBalance = parseFloat(card.faceValue.toString());
  const newBalance = currentBalance + params.amount;
  await tx.giftCard.update({
    where: { id: card.id },
    data: { faceValue: newBalance, status: 'active' },
  });
  await tx.auditLog.create({
    data: { companyId: params.companyId, userId: params.refundedBy, correlationId,
      action: 'gift_card.refund', entityType: 'gift_card', entityId: card.id,
      afterValue: JSON.stringify({ sale_return_id: params.saleReturnId, refund_amount: params.amount, new_balance: newBalance }) },
  });
  return { giftCardId: card.id, newBalance };
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
