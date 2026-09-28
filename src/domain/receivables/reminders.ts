// Due reminder engine (docs/adr/0008-due-reminders.md).
//
//   plan     installment due dates x policy stages -> reminder_occurrences
//            (unique per installment, stage and due date: reruns insert once)
//   queue    pending occurrences, inside the sending window -> one
//            outbound_messages row each (unique per occurrence)
//   send     claim one message (queued -> sending, a conditional UPDATE only
//            one worker can win), re-check everything against current data,
//            render with the current amount, call the provider outside any
//            transaction, record the outcome (sending -> sent/failed/...)
//   poll     delivery reports for sent messages (MiMSMS documents polling
//            only, available ~5 minutes after sending)
//   recover  a message left in 'sending' by a crash becomes 'unknown': the
//            provider may have accepted it, so it is never sent again
//            automatically
//
// Every function takes the tenant context of one company and touches only that
// company's rows. Status changes are conditional on the expected current
// status, so a duplicate or late job can never move a message backwards.

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withTenant, runInTenantContext, type TenantContext } from '@/lib/db/transaction';
import { encryptString, decryptString, sha256 } from '@/lib/crypto';
import { loadSmsGateway } from '@/lib/sms/credentials';
import { installmentBalances, OPEN_SALE_STATUSES } from './balances';
import { addDays, dateFromIso, daysBetween, isoFromDate, localDate, localMinuteOfDay, zonedMidnight } from './calendar';
import { normalizeBdMobile } from './phone';
import { policyFromRow, type ReminderPolicySettings } from './reminderPolicy';
import {
  DEFAULT_REMINDER_TEMPLATES, formatDueDate, formatTaka, reminderKind, renderReminder, templateCode, type ReminderLocale,
} from './reminderTemplates';
import { smsSegments } from './smsSegments';

const PAGE = 200;
/** Retry delays for a message the provider refused temporarily. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const INTERRUPTED_AFTER_MS = 10 * 60_000;
const DLR_AFTER_MS = 5 * 60_000;
const DLR_UNTIL_MS = 72 * 60 * 60_000;
/** Messages that count against daily limits: taken, or possibly taken, by the provider. */
const COUNTED = ['sending', 'sent', 'delivered', 'unknown'];

interface Setup { policy: ReminderPolicySettings | null; timezone: string; companyName: string }

async function setup(tx: Prisma.TransactionClient, companyId: string): Promise<Setup> {
  const [row, company] = await Promise.all([
    tx.reminderPolicy.findUnique({ where: { companyId } }),
    tx.company.findFirst({ where: { id: companyId }, select: { timezone: true, displayName: true } }),
  ]);
  return { policy: policyFromRow(row), timezone: company?.timezone ?? 'Asia/Dhaka', companyName: company?.displayName ?? '' };
}

/**
 * MariaDB aborts one of two transactions that conflict (deadlock, or a
 * serialization failure under SERIALIZABLE). In this engine the other run has
 * then done, or will do, the same idempotent work, so the loser gives way.
 */
function isWriteConflict(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  return e?.code === 'P2034' || /deadlock|1213|write conflict|could not serialize|1020/i.test(String(e?.message ?? ''));
}

async function yieldOnConflict<T>(fallback: T, work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) { if (isWriteConflict(error)) return fallback; throw error; }
}

// ── plan ────────────────────────────────────────────────────────────────────

/** Occurrences for every stage that falls on today. Returns how many were new. */
export async function planDueReminders(ctx: TenantContext, now = new Date()): Promise<number> {
  const companyId = ctx.companyId;
  const { policy, timezone } = await runInTenantContext(ctx, () => setup(db as unknown as Prisma.TransactionClient, companyId));
  if (!policy?.enabled) return 0;
  const today = localDate(timezone, now);
  let created = 0;
  for (const offset of policy.stageOffsets) {
    // An installment is at stage `offset` today if it fell (or falls) due `offset` days before today.
    const dueDate = dateFromIso(addDays(today, -offset));
    let cursor: string | undefined;
    for (;;) {
      const page = await runInTenantContext(ctx, () => db.installment.findMany({
        where: { companyId, status: 'scheduled', dueDate,
          sale: { dueRemindersEnabled: true, saleStatus: { in: [...OPEN_SALE_STATUSES] }, customerId: { not: null } } },
        select: { id: true },
        orderBy: { id: 'asc' }, take: PAGE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }));
      if (page.length === 0) break;
      created += await yieldOnConflict(0, () => withTenant(ctx, async tx => {
        const due = (await installmentBalances(tx, companyId, { installmentIds: page.map(p => p.id) }))
          .filter(b => b.customerId && b.outstanding.gt(0) && b.outstanding.gte(policy.minOutstanding));
        if (due.length === 0) return 0;
        const result = await tx.reminderOccurrence.createMany({
          data: due.map(b => ({
            companyId, installmentId: b.installmentId, saleId: b.saleId, customerId: b.customerId!,
            stageOffsetDays: offset, dueDate: b.dueDate, scheduledFor: now,
          })),
          skipDuplicates: true, // the unique key makes a rerun a no-op
        });
        return result.count;
      }));
      if (page.length < PAGE) break;
      cursor = page[page.length - 1].id;
    }
  }
  return created;
}

// ── shared checks ───────────────────────────────────────────────────────────

type Occurrence = Prisma.ReminderOccurrenceGetPayload<{
  include: { installment: true; sale: { select: { referenceNo: true; saleStatus: true; dueRemindersEnabled: true; customerPhoneSnapshot: true } };
    customer: { select: { name: true; phone: true } } };
}>;

/** Why an occurrence must not be messaged now, or null if it may. */
async function blockReason(tx: Prisma.TransactionClient, occurrence: Occurrence, policy: ReminderPolicySettings | null, today: string) {
  if (!policy?.enabled) return { status: 'cancelled', reason: 'policy_disabled' } as const;
  if (addDays(isoFromDate(occurrence.dueDate), occurrence.stageOffsetDays) !== today) return { status: 'cancelled', reason: 'stage_passed' } as const;
  if (occurrence.installment.status !== 'scheduled') return { status: 'cancelled', reason: 'installment_cancelled' } as const;
  if (occurrence.installment.dueDate.getTime() !== occurrence.dueDate.getTime()) return { status: 'cancelled', reason: 'due_date_changed' } as const;
  if (!OPEN_SALE_STATUSES.includes(occurrence.sale.saleStatus as never)) return { status: 'cancelled', reason: 'sale_not_open' } as const;
  if (!occurrence.sale.dueRemindersEnabled) return { status: 'cancelled', reason: 'reminders_off_for_sale' } as const;
  const [balance] = await installmentBalances(tx, occurrence.companyId, { installmentIds: [occurrence.installmentId] });
  if (!balance || balance.outstanding.lte(0)) return { status: 'skipped', reason: 'paid' } as const;
  if (balance.outstanding.lt(policy.minOutstanding)) return { status: 'skipped', reason: 'below_minimum' } as const;
  const optOut = await tx.communicationConsent.findFirst({
    where: { companyId: occurrence.companyId, customerId: occurrence.customerId, channel: 'sms', purpose: 'transactional' },
    orderBy: { capturedAt: 'desc' }, select: { consentStatus: true },
  });
  if (optOut?.consentStatus === 'withdrawn') return { status: 'skipped', reason: 'opted_out' } as const;
  return null;
}

async function renderFor(tx: Prisma.TransactionClient, occurrence: Occurrence, outstanding: Prisma.Decimal, locale: ReminderLocale, companyName: string, today: string) {
  const kind = reminderKind(occurrence.stageOffsetDays);
  const custom = await tx.communicationTemplate.findFirst({
    where: { companyId: occurrence.companyId, code: templateCode(kind, locale), channel: 'sms', isActive: true },
    select: { id: true, bodyTemplate: true },
  });
  const dueIso = isoFromDate(occurrence.dueDate);
  const text = renderReminder(custom?.bodyTemplate ?? DEFAULT_REMINDER_TEMPLATES[locale][kind], {
    customer_name: occurrence.customer.name, company_name: companyName,
    invoice_no: occurrence.sale.referenceNo, installment_no: String(occurrence.installment.installmentNo),
    due_amount: formatTaka(outstanding.toFixed(2)), outstanding_amount: formatTaka(outstanding.toFixed(2)),
    due_date: formatDueDate(dueIso, locale), days_overdue: String(Math.max(0, daysBetween(dueIso, today))),
  });
  return { text, templateId: custom?.id ?? null, ...smsSegments(text) };
}

const occurrenceInclude = {
  installment: true,
  sale: { select: { referenceNo: true, saleStatus: true, dueRemindersEnabled: true, customerPhoneSnapshot: true } },
  customer: { select: { name: true, phone: true } },
} as const;

// ── queue ───────────────────────────────────────────────────────────────────

/** A message for each pending occurrence, inside the sending window. */
export async function queueDueReminderMessages(ctx: TenantContext, now = new Date()): Promise<{ queued: number; skipped: number }> {
  const companyId = ctx.companyId;
  const { policy, timezone, companyName } = await runInTenantContext(ctx, () => setup(db as unknown as Prisma.TransactionClient, companyId));
  const counts = { queued: 0, skipped: 0 };
  if (!policy?.enabled) return counts;
  const minute = localMinuteOfDay(timezone, now);
  if (minute < policy.sendWindowStartMinute || minute >= policy.sendWindowEndMinute) return counts;
  const today = localDate(timezone, now);

  for (;;) {
    const page = await runInTenantContext(ctx, () => db.reminderOccurrence.findMany({
      where: { companyId, status: 'pending', scheduledFor: { lte: now } },
      include: occurrenceInclude, orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }], take: PAGE,
    }));
    if (page.length === 0) break;
    for (const occurrence of page) {
      await yieldOnConflict(undefined, () => withTenant(ctx, async tx => {
        // Only a still-pending occurrence moves on; a concurrent run that got
        // here first leaves nothing to do.
        const blocked = await blockReason(tx, occurrence, policy, today);
        const phone = normalizeBdMobile(occurrence.sale.customerPhoneSnapshot) ?? normalizeBdMobile(occurrence.customer.phone);
        const reason = blocked?.reason ?? (phone ? null : (occurrence.sale.customerPhoneSnapshot || occurrence.customer.phone ? 'invalid_phone' : 'missing_phone'));
        if (reason) {
          const moved = await tx.reminderOccurrence.updateMany({ where: { id: occurrence.id, companyId, status: 'pending' },
            data: { status: blocked?.status ?? 'skipped', skipReason: reason } });
          counts.skipped += moved.count;
          return;
        }
        const [balance] = await installmentBalances(tx, companyId, { installmentIds: [occurrence.installmentId] });
        const rendered = await renderFor(tx, occurrence, balance.outstanding, policy.locale, companyName, today);
        const moved = await tx.reminderOccurrence.updateMany({ where: { id: occurrence.id, companyId, status: 'pending' }, data: { status: 'messaged' } });
        if (moved.count !== 1) return;
        await tx.outboundMessage.create({ data: {
          companyId, channel: 'sms', purpose: 'transactional', triggerSource: 'reminder',
          reminderOccurrenceId: occurrence.id, installmentId: occurrence.installmentId, saleId: occurrence.saleId, customerId: occurrence.customerId,
          templateId: rendered.templateId, locale: policy.locale,
          destinationHash: sha256(phone!), destinationEncrypted: encryptString(phone!).ciphertext.toString('base64'),
          renderedBody: rendered.text, encoding: rendered.encoding, segments: rendered.segments, status: 'queued',
        } });
        counts.queued++;
      }));
    }
    if (page.length < PAGE) break;
  }
  return counts;
}

// ── send ────────────────────────────────────────────────────────────────────


export type SendResult = 'not_claimed' | 'sent' | 'skipped' | 'cancelled' | 'retry' | 'failed' | 'unknown' | 'dead_letter' | 'deferred';

/** Claim, re-check, render and send one message. Safe to call twice for the same message. */
export async function sendOutboundMessage(ctx: TenantContext, messageId: string, now = new Date(), fetchImpl?: typeof fetch): Promise<SendResult> {
  const companyId = ctx.companyId;
  let claimed: { count: number };
  try {
    claimed = await withTenant(ctx, tx => tx.outboundMessage.updateMany({
      where: { id: messageId, companyId, channel: 'sms', status: 'queued', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      data: { status: 'sending', claimedAt: now, attemptCount: { increment: 1 } },
    }));
  } catch (error) {
    // Two workers claiming at once: MariaDB aborts one of the conflicting
    // transactions (deadlock / serialization failure). The other holds the claim.
    if (isWriteConflict(error)) return 'not_claimed';
    throw error;
  }
  if (claimed.count !== 1) return 'not_claimed';

  const finish = (status: string, data: Prisma.OutboundMessageUpdateManyMutationInput) =>
    withTenant(ctx, tx => tx.outboundMessage.updateMany({ where: { id: messageId, companyId, status: 'sending' }, data: { status, ...data } }));

  // Re-check against current data, and render the current amount.
  const prepared = await withTenant(ctx, async tx => {
    const message = await tx.outboundMessage.findFirstOrThrow({ where: { id: messageId, companyId } });
    const { policy, timezone, companyName } = await setup(tx, companyId);
    const today = localDate(timezone, now);
    let text = message.renderedBody;
    if (message.reminderOccurrenceId) {
      const occurrence = await tx.reminderOccurrence.findFirstOrThrow({ where: { id: message.reminderOccurrenceId, companyId }, include: occurrenceInclude });
      const blocked = await blockReason(tx, occurrence, policy, today);
      if (blocked) return { stop: blocked } as const;
      const minute = localMinuteOfDay(timezone, now);
      if (minute < policy!.sendWindowStartMinute || minute >= policy!.sendWindowEndMinute) return { defer: true } as const;
      const [balance] = await installmentBalances(tx, companyId, { installmentIds: [occurrence.installmentId] });
      text = (await renderFor(tx, occurrence, balance.outstanding, (message.locale as ReminderLocale) ?? policy!.locale, companyName, today)).text;
      // Daily limits, counted from the start of the company's day.
      const since = zonedMidnight(timezone, today);
      const [toCustomer, total] = await Promise.all([
        tx.outboundMessage.count({ where: { companyId, destinationHash: message.destinationHash, status: { in: COUNTED }, claimedAt: { gte: since }, NOT: { id: messageId } } }),
        tx.outboundMessage.count({ where: { companyId, status: { in: COUNTED }, claimedAt: { gte: since }, NOT: { id: messageId } } }),
      ]);
      if (toCustomer >= policy!.maxPerCustomerPerDay) return { stop: { status: 'skipped', reason: 'customer_daily_limit' } } as const;
      if (total >= policy!.dailyCompanyLimit) return { stop: { status: 'skipped', reason: 'company_daily_limit' } } as const;
    }
    const gateway = await loadSmsGateway(tx, companyId, fetchImpl);
    return { message, text, gateway } as const;
  });

  if ('defer' in prepared) {
    // Outside the sending window: release the claim; the next run inside it sends.
    await withTenant(ctx, tx => tx.outboundMessage.updateMany({ where: { id: messageId, companyId, status: 'sending' },
      data: { status: 'queued', claimedAt: null, attemptCount: { decrement: 1 } } }));
    return 'deferred';
  }
  if ('stop' in prepared && prepared.stop) {
    const { status, reason } = prepared.stop;
    await finish(status, { lastErrorCode: reason, failureCategory: 'validation' });
    return status;
  }
  if (!('message' in prepared)) throw new Error('unreachable');
  const { message, text, gateway } = prepared;
  const segments = smsSegments(text);
  if (!gateway) {
    await finish('failed', { lastErrorCode: 'sms_account_not_configured', failureCategory: 'permanent', renderedBody: text });
    return 'failed';
  }
  const to = decryptString(Buffer.from(message.destinationEncrypted, 'base64'));

  const outcome = await gateway.send({ to, text });

  const base = { renderedBody: text, encoding: segments.encoding, segments: segments.segments, providerCode: gateway.providerCode };
  switch (outcome.kind) {
    case 'accepted':
      await finish('sent', { ...base, providerMessageId: outcome.providerMessageId, segments: outcome.segments ?? segments.segments,
        sentAt: now, lastErrorCode: null, failureCategory: null });
      return 'sent';
    case 'permanent':
      await finish('failed', { ...base, lastErrorCode: outcome.code, failureCategory: 'permanent' });
      return 'failed';
    case 'ambiguous':
      await finish('unknown', { ...base, lastErrorCode: outcome.code, failureCategory: 'ambiguous' });
      return 'unknown';
    case 'retryable': {
      const attempt = message.attemptCount; // already incremented by the claim
      if (attempt > RETRY_DELAYS_MS.length) {
        await finish('dead_letter', { ...base, lastErrorCode: outcome.code, failureCategory: 'retryable' });
        return 'dead_letter';
      }
      await finish('queued', { ...base, lastErrorCode: outcome.code, failureCategory: 'retryable',
        claimedAt: null, nextAttemptAt: new Date(now.getTime() + RETRY_DELAYS_MS[attempt - 1]) });
      return 'retry';
    }
  }
}

/** Queued messages that are due for a send attempt, oldest first. */
export async function sendableMessageIds(ctx: TenantContext, now = new Date(), limit = PAGE): Promise<string[]> {
  const rows = await runInTenantContext(ctx, () => db.outboundMessage.findMany({
    where: { companyId: ctx.companyId, channel: 'sms', status: 'queued', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit,
  }));
  return rows.map(r => r.id);
}

// ── recover / poll ──────────────────────────────────────────────────────────

/** Sends interrupted mid-flight: the provider may have the message, so never resend. */
export async function recoverInterruptedSends(ctx: TenantContext, now = new Date()): Promise<number> {
  const result = await withTenant(ctx, tx => tx.outboundMessage.updateMany({
    where: { companyId: ctx.companyId, status: 'sending', claimedAt: { lt: new Date(now.getTime() - INTERRUPTED_AFTER_MS) } },
    data: { status: 'unknown', failureCategory: 'ambiguous', lastErrorCode: 'interrupted_during_send' },
  }));
  return result.count;
}

export async function pollDeliveryReports(ctx: TenantContext, now = new Date(), fetchImpl?: typeof fetch): Promise<{ delivered: number; failed: number }> {
  const companyId = ctx.companyId;
  const counts = { delivered: 0, failed: 0 };
  const gateway = await runInTenantContext(ctx, () => loadSmsGateway(db as unknown as Prisma.TransactionClient, companyId, fetchImpl));
  if (!gateway?.deliveryStatus) return counts;
  const due = await runInTenantContext(ctx, () => db.outboundMessage.findMany({
    where: { companyId, status: 'sent', providerCode: gateway.providerCode, providerMessageId: { not: null },
      sentAt: { lte: new Date(now.getTime() - DLR_AFTER_MS), gte: new Date(now.getTime() - DLR_UNTIL_MS) } },
    select: { id: true, providerMessageId: true, destinationEncrypted: true },
    orderBy: { sentAt: 'asc' }, take: PAGE,
  }));
  for (const message of due) {
    const status = await gateway.deliveryStatus(message.providerMessageId!, decryptString(Buffer.from(message.destinationEncrypted, 'base64')));
    if (status.kind !== 'delivered' && status.kind !== 'failed') continue;
    const moved = await withTenant(ctx, tx => tx.outboundMessage.updateMany({
      where: { id: message.id, companyId, status: 'sent' },
      data: status.kind === 'delivered'
        ? { status: 'delivered', deliveredAt: now, providerStatus: status.providerStatus }
        : { status: 'failed', failureCategory: 'delivery', providerStatus: status.providerStatus, lastErrorCode: 'undelivered' },
    }));
    if (moved.count) counts[status.kind]++;
  }
  return counts;
}
