// src/workers/outboxWorker.ts
// Outbox event delivery worker per §5.16 + §6 rule 14.

import { systemDb as db } from '@/lib/db';
import { signWebhook, generateDeliveryId, getTimestampHeader } from '@/lib/integrations/webhook';
import { decryptString } from '@/lib/crypto';
import { recordSecurityEvent } from '@/lib/audit';
import { postToOutboundUrl } from '@/lib/integrations/outboundUrl';
import { errorMeta, logger } from '@/lib/logging';

const POLL_INTERVAL_MS = 10_000;
const HTTP_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_EXCERPT = 500;

let isRunning = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

/** How long a claimed event is hidden from other runners while it is delivered. */
export const OUTBOX_LEASE_MS = 5 * 60_000;

/**
 * Deliver due events. Each event is first claimed with a conditional update
 * that only one runner can win (F-45: several runners used to deliver the
 * same event at once); a crashed runner's claim expires after the lease and
 * the event is retried. An endpoint that already received the event is not
 * sent it again, and the event is published only when every subscribed
 * endpoint has it.
 */
export async function processOutboxBatch(now = new Date()): Promise<number> {
  const pendingEvents = await db.outboxEvent.findMany({
    where: { status: 'pending', nextAttemptAt: { lte: now } },
    take: 50, orderBy: { nextAttemptAt: 'asc' },
    include: { company: { include: { webhookEndpoints: { where: { status: 'active' } } } } },
  });

  let deliveryCount = 0;

  for (const event of pendingEvents) {
    const claimed = await db.outboxEvent.updateMany({
      where: { id: event.id, status: 'pending', nextAttemptAt: event.nextAttemptAt },
      data: { nextAttemptAt: new Date(now.getTime() + OUTBOX_LEASE_MS) },
    });
    if (claimed.count !== 1) continue; // another runner has it

    const endpoints = event.company.webhookEndpoints.filter(ep => {
      const subscribed = JSON.parse(ep.subscribedEvents) as string[];
      return subscribed.includes(event.eventName) || subscribed.includes('*');
    });

    if (endpoints.length === 0) {
      await db.outboxEvent.update({ where: { id: event.id }, data: { status: 'skipped', publishedAt: new Date() } });
      continue;
    }

    const failures: string[] = [];
    for (const endpoint of endpoints) {
      const outcome = await deliverWebhook(event, endpoint);
      if (outcome === 'sent' || outcome === 'failed') deliveryCount++;
      if (outcome === 'failed' || outcome === 'unusable') failures.push(endpoint.id);
    }

    if (failures.length === 0) {
      await db.outboxEvent.updateMany({ where: { id: event.id, status: 'pending' },
        data: { status: 'published', publishedAt: new Date(), lastError: null } });
      continue;
    }
    const attemptCount = event.attemptCount + 1;
    if (attemptCount >= event.maxAttempts) {
      await db.outboxEvent.updateMany({
        where: { id: event.id, status: 'pending' },
        data: { status: 'dead_letter', attemptCount, deadLetteredAt: new Date(), deadLetterReason: `Max attempts (${event.maxAttempts}) exceeded` },
      });
      await recordSecurityEvent({
        eventType: 'outbox_dead_letter', severity: 'critical',
        metadata: { outbox_event_id: event.id, event_name: event.eventName, attempt_count: attemptCount, failed_endpoints: failures.length },
        companyId: event.companyId,
      });
    } else {
      await db.outboxEvent.updateMany({ where: { id: event.id, status: 'pending' },
        data: { attemptCount, lastError: `${failures.length} endpoint(s) not delivered`, nextAttemptAt: computeBackoff(attemptCount) } });
    }
  }
  return deliveryCount;
}

type DeliveryOutcome = 'sent' | 'already_delivered' | 'failed' | 'unusable';

async function deliverWebhook(event: any, endpoint: any): Promise<DeliveryOutcome> {
  const existing = await db.webhookDelivery.findUnique({
    where: { webhookEndpointId_outboxEventId: { webhookEndpointId: endpoint.id, outboxEventId: event.id } },
  });
  if (existing?.status === 'delivered') return 'already_delivered';

  const timestamp = getTimestampHeader();
  let secret: string;
  try { secret = decryptString(endpoint.secretCiphertext, 1); }
  catch { logger.error('[outbox-worker] webhook secret cannot be decrypted', { endpoint_id: endpoint.id }); return 'unusable'; }

  const signature = signWebhook(secret, timestamp, event.payload);
  const deliveryIdToUse = existing?.deliveryId ?? generateDeliveryId();
  if (!existing) {
    await db.webhookDelivery.create({
      data: { companyId: event.companyId, webhookEndpointId: endpoint.id, outboxEventId: event.id,
        deliveryId: deliveryIdToUse, signature, timestampHeader: timestamp, status: 'pending' },
    });
  }

  try {
    // Not fetch(): fetch follows redirects and resolves DNS separately from the
    // connect. postToOutboundUrl checks the address inside the socket's own
    // lookup, never follows a redirect, and caps time and body size.
    const response = await postToOutboundUrl(endpoint.url, {
      headers: { 'Content-Type': 'application/json',
        'X-ERP-Signature': `sha256=${signature}`, 'X-ERP-Timestamp': timestamp, 'X-ERP-Delivery-ID': deliveryIdToUse },
      body: event.payload,
      timeoutMs: HTTP_TIMEOUT_MS,
      maxBodyBytes: MAX_RESPONSE_EXCERPT,
    });
    await db.webhookDelivery.update({
      where: { deliveryId: deliveryIdToUse },
      data: { status: response.ok ? 'delivered' : 'failed', attemptCount: { increment: 1 },
        lastAttemptedAt: new Date(), responseStatus: response.status,
        responseBodyExcerpt: response.body, lastError: response.ok ? null : `HTTP ${response.status}`,
        nextAttemptAt: response.ok ? new Date() : computeBackoff(event.attemptCount + 1) },
    });
    return response.ok ? 'sent' : 'failed';
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Network error';
    await db.webhookDelivery.update({ where: { deliveryId: deliveryIdToUse },
      data: { status: 'failed', attemptCount: { increment: 1 }, lastAttemptedAt: new Date(),
        lastError: errorMsg, nextAttemptAt: computeBackoff(event.attemptCount + 1) } });
    return 'failed';
  }
}

function computeBackoff(attempt: number): Date {
  const baseMs = 1_000, maxMs = 60 * 60 * 1000;
  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = Math.random() * baseMs;
  return new Date(Date.now() + exponential + jitter);
}

export function startOutboxWorker(): void {
  if (isRunning) return;
  isRunning = true;

  // Production: BullMQ Worker polls outbox queue — see src/workers/index.ts.
  // Sandbox/dev: fall back to setInterval polling inside the web process.
  const useBullMQ = process.env.NODE_ENV === 'production' && process.env.REDIS_URL;
  if (useBullMQ) {
    logger.info('[outbox-worker] production: the BullMQ worker delivers (src/workers/index.ts)');
    return;
  }

  logger.info('[outbox-worker] development: polling', { interval_ms: POLL_INTERVAL_MS });
  intervalId = setInterval(async () => {
    try { const count = await processOutboxBatch(); if (count > 0) logger.info('[outbox-worker] deliveries processed', { count }); }
    catch (e) { logger.error('[outbox-worker] batch failed', errorMeta(e)); }
  }, POLL_INTERVAL_MS);
}

export function stopOutboxWorker(): void {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  isRunning = false;
  logger.info('[outbox-worker] stopped');
}
