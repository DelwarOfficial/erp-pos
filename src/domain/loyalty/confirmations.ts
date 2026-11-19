// Customer consent for spending reward points: a one-time code.
//
// 1. request: the till asks for a code for (customer, points, cart). The
//    server checks the balance, makes a 6-digit code, stores only a keyed hash
//    of it, and texts it to the customer's phone on file.
// 2. verify: the cashier types the code the customer reads out. Five wrong
//    codes lock the request. Wrong attempts are counted in their own
//    transaction, so a failed sale cannot undo them.
// 3. consume: postSale, inside the sale's transaction, takes the verified
//    confirmation for exactly this customer, points and cart and marks it used
//    by this sale. Any change to those makes the confirmation not match.
//
// A confirmation lives 5 minutes from the request and is used once. Selecting
// a customer, or holding a cashier permission, is not consent. Offline sales
// cannot use points at all (cash only), so there is no replay path.

import { Prisma } from '@prisma/client';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { hmacSha256 } from '@/lib/crypto';
import { barcodeSigningKey } from '@/domain/invariants/barcode';
import { DomainError } from '@/lib/errors/codes';
import { maskBdMobile, normalizeBdMobile } from '@/domain/receivables/phone';
import type { SmsGateway } from '@/lib/sms/gateway';
import { pointsBalance } from './points';

type Tx = Prisma.TransactionClient;

export const CONFIRMATION_TTL_MS = 5 * 60 * 1000;
export const CONFIRMATION_MAX_ATTEMPTS = 5;

export interface PointsIntent {
  customerId: string;
  points: number;
  items: Array<{ productId: string; qty: number; unitPrice: number; discountAmount?: number }>;
  couponCode?: string | null;
}

/** A stable hash of what the customer agreed to: customer, points and the cart. */
export function pointsIntentHash(intent: PointsIntent): string {
  const canonical = JSON.stringify({
    c: intent.customerId,
    p: intent.points,
    k: (intent.couponCode ?? '').trim().toUpperCase(),
    i: intent.items.map(i => [i.productId, new Prisma.Decimal(i.qty).toString(), new Prisma.Decimal(i.unitPrice).toFixed(2), new Prisma.Decimal(i.discountAmount ?? 0).toFixed(2)]),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

const codeHash = (id: string, code: string) => hmacSha256(barcodeSigningKey(), `reward-points:${id}:${code}`);

export async function requestPointsConfirmation(tx: Tx, input: { companyId: string; requestedBy: string; intent: PointsIntent; gateway: SmsGateway | null; correlationId: string }) {
  const { intent } = input;
  if (!Number.isInteger(intent.points) || intent.points <= 0) throw new DomainError('VALIDATION_FAILED', 'Points are spent in whole points', {}, 400);
  const customer = await tx.customer.findFirst({ where: { id: intent.customerId, companyId: input.companyId, deletedAt: null }, select: { id: true, phone: true } });
  if (!customer) throw new DomainError('RESOURCE_NOT_FOUND', 'Customer not found', {}, 404);
  const phone = normalizeBdMobile(customer.phone);
  if (!phone) throw new DomainError('VALIDATION_FAILED', "This customer has no mobile number on file, so their points can't be confirmed. Add a number to their record first.", {}, 409);
  const balance = await pointsBalance(tx, input.companyId, intent.customerId);
  if (balance < intent.points) throw new DomainError('REWARD_POINTS_INSUFFICIENT', `The customer has ${balance} points`, { balance }, 409);
  if (!input.gateway) throw new DomainError('EXTERNAL_PROVIDER_ERROR', 'SMS is not set up for this company, so points cannot be confirmed. Set up SMS first.', {}, 503);

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS);
  await tx.rewardPointConfirmation.create({ data: { id, companyId: input.companyId, customerId: intent.customerId, points: intent.points,
    intentHash: pointsIntentHash(intent), codeHash: codeHash(id, code), phoneMasked: maskBdMobile(phone), expiresAt, requestedBy: input.requestedBy } });
  const sent = await input.gateway.send({ to: phone, kind: 'transactional',
    text: `Your code to spend ${intent.points} reward points is ${code}. Valid 5 minutes. Share it only with the cashier serving you.` });
  if (sent.kind !== 'accepted') throw new DomainError('EXTERNAL_PROVIDER_ERROR', "We couldn't text the code. Try again in a moment.", { sms: sent.kind }, 502);
  await tx.auditLog.create({ data: { companyId: input.companyId, userId: input.requestedBy, correlationId: input.correlationId, action: 'reward_points.confirmation_requested',
    entityType: 'reward_point_confirmation', entityId: id, afterValue: JSON.stringify({ customer_id: intent.customerId, points: intent.points, phone: maskBdMobile(phone) }) } });
  return { id, expiresAt, phoneMasked: maskBdMobile(phone) };
}

export async function verifyPointsConfirmation(tx: Tx, input: { companyId: string; customerId: string; confirmationId: string; code: string; userId: string; correlationId: string }) {
  await tx.$queryRaw`SELECT id FROM reward_point_confirmations WHERE id = ${input.confirmationId} FOR UPDATE`;
  const row = await tx.rewardPointConfirmation.findFirst({ where: { id: input.confirmationId, companyId: input.companyId, customerId: input.customerId } });
  if (!row) throw new DomainError('RESOURCE_NOT_FOUND', 'That confirmation was not found', {}, 404);
  if (row.status === 'locked') throw new DomainError('VERIFICATION_REQUIRED', 'Too many wrong codes. Send a new code.', {}, 409);
  if (row.status !== 'pending') throw new DomainError('VERIFICATION_REQUIRED', 'This code has already been used. Send a new code.', {}, 409);
  if (row.expiresAt <= new Date()) throw new DomainError('VERIFICATION_REQUIRED', 'The code has expired. Send a new code.', {}, 409);
  const supplied = Buffer.from(codeHash(row.id, input.code.trim()));
  const ok = /^\d{6}$/.test(input.code.trim()) && timingSafeEqual(supplied, Buffer.from(row.codeHash));
  const audit = (outcome: string) => tx.auditLog.create({ data: { companyId: input.companyId, userId: input.userId, correlationId: input.correlationId, action: `reward_points.confirmation_${outcome}`,
    entityType: 'reward_point_confirmation', entityId: row.id, afterValue: JSON.stringify({ attempts: row.attempts + (ok ? 0 : 1) }) } });
  if (!ok) {
    const attempts = row.attempts + 1;
    await tx.rewardPointConfirmation.update({ where: { id: row.id }, data: { attempts, ...(attempts >= CONFIRMATION_MAX_ATTEMPTS ? { status: 'locked' } : {}) } });
    await audit(attempts >= CONFIRMATION_MAX_ATTEMPTS ? 'locked' : 'wrong_code');
    return { verified: false as const, attemptsLeft: Math.max(0, CONFIRMATION_MAX_ATTEMPTS - attempts) };
  }
  await tx.rewardPointConfirmation.update({ where: { id: row.id }, data: { status: 'verified', verifiedAt: new Date() } });
  await audit('verified');
  return { verified: true as const, attemptsLeft: CONFIRMATION_MAX_ATTEMPTS - row.attempts };
}

/** Inside the sale's transaction: the verified confirmation for exactly this intent, used once. */
export async function consumePointsConfirmation(tx: Tx, input: { companyId: string; confirmationId: string | undefined; saleId: string; intent: PointsIntent }) {
  if (!input.confirmationId) throw new DomainError('VERIFICATION_REQUIRED', 'The customer must confirm spending points with the code texted to them', {}, 403);
  await tx.$queryRaw`SELECT id FROM reward_point_confirmations WHERE id = ${input.confirmationId} FOR UPDATE`;
  const row = await tx.rewardPointConfirmation.findFirst({ where: { id: input.confirmationId, companyId: input.companyId } });
  const refuse = (message: string) => new DomainError('VERIFICATION_REQUIRED', message, {}, 403);
  if (!row || row.customerId !== input.intent.customerId) throw refuse('That points confirmation is not for this customer');
  if (row.status !== 'verified') throw refuse(row.status === 'consumed' ? 'That points confirmation has already been used' : 'The points code has not been confirmed');
  if (row.expiresAt <= new Date()) throw refuse('The points confirmation has expired. Send a new code.');
  if (row.points !== input.intent.points || row.intentHash !== pointsIntentHash(input.intent)) {
    throw refuse('The sale changed after the customer confirmed. Send a new code for the new amount.');
  }
  await tx.rewardPointConfirmation.update({ where: { id: row.id }, data: { status: 'consumed', consumedAt: new Date(), consumedSaleId: input.saleId } });
}
