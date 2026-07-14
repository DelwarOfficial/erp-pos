// src/workers/outboxWorker.ts
// Outbox event delivery worker per §5.16 + §6 rule 14.

import { db } from '@/lib/db';
import { signWebhook, generateDeliveryId, getTimestampHeader } from '@/lib/integrations/webhook';
import { decryptString } from '@/lib/crypto';
import { recordSecurityEvent } from '@/lib/audit';

const POLL_INTERVAL_MS = 10_000;
const HTTP_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_EXCERPT = 500;

let isRunning = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

export async function processOutboxBatch(): Promise<number> {
  const pendingEvents = await db.outboxEvent.findMany({
    where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
    take: 50, orderBy: { nextAttemptAt: 'asc' },
    include: { company: { include: { webhookEndpoints: { where: { status: 'active' } } } } },
  });

  let deliveryCount = 0;

  for (const event of pendingEvents) {
    const endpoints = event.company.webhookEndpoints.filter(ep => {
      const subscribed = JSON.parse(ep.subscribedEvents) as string[];
      return subscribed.includes(event.eventName) || subscribed.includes('*');
    });

    if (endpoints.length === 0) {
      await db.outboxEvent.update({ where: { id: event.id }, data: { status: 'skipped', publishedAt: new Date() } });
      continue;
    }

    for (const endpoint of endpoints) {
      await deliverWebhook(event, endpoint);
      deliveryCount++;
    }

    const stillPending = await db.outboxEvent.findUnique({ where: { id: event.id } });
    if (stillPending && stillPending.status === 'pending' && stillPending.attemptCount >= stillPending.maxAttempts) {
      await db.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'dead_letter', deadLetteredAt: new Date(), deadLetterReason: `Max attempts (${stillPending.maxAttempts}) exceeded` },
      });
      await recordSecurityEvent({
        eventType: 'outbox_dead_letter', severity: 'critical',
        metadata: { outbox_event_id: event.id, event_name: event.eventName, attempt_count: stillPending.attemptCount },
        companyId: event.companyId,
      });
    }
  }
  return deliveryCount;
}

async function deliverWebhook(event: any, endpoint: any): Promise<void> {
  const timestamp = getTimestampHeader();
  const deliveryId = generateDeliveryId();

  let secret: string;
  try { secret = decryptString(endpoint.secretCiphertext, 1); }
  catch { console.error(`Failed to decrypt webhook secret for endpoint ${endpoint.id}`); return; }

  const signature = signWebhook(secret, timestamp, event.payload);
  const existing = await db.webhookDelivery.findUnique({
    where: { webhookEndpointId_outboxEventId: { webhookEndpointId: endpoint.id, outboxEventId: event.id } },
  });

  let deliveryIdToUse = existing?.deliveryId ?? deliveryId;
  if (!existing) {
    await db.webhookDelivery.create({
      data: { companyId: event.companyId, webhookEndpointId: endpoint.id, outboxEventId: event.id,
        deliveryId: deliveryIdToUse, signature, timestampHeader: timestamp, status: 'pending' },
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
        'X-ERP-Signature': `sha256=${signature}`, 'X-ERP-Timestamp': timestamp, 'X-ERP-Delivery-ID': deliveryIdToUse },
      body: event.payload, signal: controller.signal,
    });
    const responseText = await response.text();
    const excerpt = responseText.slice(0, MAX_RESPONSE_EXCERPT);

    await db.webhookDelivery.update({
      where: { deliveryId: deliveryIdToUse },
      data: { status: response.ok ? 'delivered' : 'failed', attemptCount: { increment: 1 },
        lastAttemptedAt: new Date(), responseStatus: response.status,
        responseBodyExcerpt: excerpt, lastError: response.ok ? null : `HTTP ${response.status}`,
        nextAttemptAt: response.ok ? new Date() : computeBackoff(event.attemptCount + 1) },
    });

    if (response.ok) {
      await db.outboxEvent.updateMany({ where: { id: event.id, status: 'pending' },
        data: { status: 'published', publishedAt: new Date() } });
    } else {
      await db.outboxEvent.update({ where: { id: event.id },
        data: { attemptCount: { increment: 1 }, lastError: `HTTP ${response.status}`,
          nextAttemptAt: computeBackoff(event.attemptCount + 1) } });
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Network error';
    await db.webhookDelivery.update({ where: { deliveryId: deliveryIdToUse },
      data: { status: 'failed', attemptCount: { increment: 1 }, lastAttemptedAt: new Date(),
        lastError: errorMsg, nextAttemptAt: computeBackoff(event.attemptCount + 1) } });
    await db.outboxEvent.update({ where: { id: event.id },
      data: { attemptCount: { increment: 1 }, lastError: errorMsg, nextAttemptAt: computeBackoff(event.attemptCount + 1) } });
  } finally { clearTimeout(timeout); }
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
    console.log('[outbox-worker] Production mode — BullMQ worker handles delivery (see src/workers/index.ts)');
    return;
  }

  console.log('[outbox-worker] Dev mode — polling every', POLL_INTERVAL_MS, 'ms');
  intervalId = setInterval(async () => {
    try { const count = await processOutboxBatch(); if (count > 0) console.log(`[outbox-worker] Processed ${count} deliveries`); }
    catch (e) { console.error('[outbox-worker] Error:', e); }
  }, POLL_INTERVAL_MS);
}

export function stopOutboxWorker(): void {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  isRunning = false;
  console.log('[outbox-worker] Stopped');
}
