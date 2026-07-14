// src/domain/commands/m6/Loyalty.ts
// Gift card + coupon + reward point commands per §5.13 + §20.D17.
// IssueGiftCard, RedeemGiftCard, PostGiftCardRefund, RedeemCoupon, EarnRewardPoints, RedeemRewardPoints.

import { Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';

// ── IssueGiftCard ──
export async function issueGiftCard(
  tx: Prisma.TransactionClient,
  params: { companyId: string; faceValue: number; expiresAt?: Date; issuedBy: string },
  correlationId: string,
): Promise<{ giftCardId: string; code: string }> {
  const code = 'GC-' + randomBytes(8).toString('hex').toUpperCase();
  const card = await tx.giftCard.create({
    data: { companyId: params.companyId, code, faceValue: params.faceValue,
      status: 'active', expiresAt: params.expiresAt ?? null, issuedBy: params.issuedBy },
  });
  await tx.auditLog.create({
    data: { companyId: params.companyId, userId: params.issuedBy, correlationId,
      action: 'gift_card.issue', entityType: 'gift_card', entityId: card.id,
      afterValue: JSON.stringify({ code, face_value: params.faceValue }) },
  });
  return { giftCardId: card.id, code };
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
