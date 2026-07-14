// src/lib/integrations/webhook.ts
// Webhook HMAC-SHA256 signing and verification per §6 rule 14 + §20.D20.

import { createHmac, timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';

const REPLAY_TOLERANCE_MS = 5 * 60 * 1000;

export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(`${timestamp}.${rawBody}`);
  return hmac.digest('hex');
}

export function verifyWebhookSignature(
  secret: string, timestamp: string, rawBody: string, signature: string,
): { valid: boolean; reason?: string } {
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return { valid: false, reason: 'Invalid timestamp format' };
  const age = Math.abs(Date.now() - ts * 1000);
  if (age > REPLAY_TOLERANCE_MS) {
    return { valid: false, reason: `Replay outside tolerance: ${Math.floor(age / 1000)}s` };
  }
  const expected = signWebhook(secret, timestamp, rawBody);
  try {
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return { valid: false, reason: 'Signature length mismatch' };
    if (!timingSafeEqual(a, b)) return { valid: false, reason: 'Signature mismatch' };
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Invalid signature encoding' };
  }
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

export function generateDeliveryId(): string {
  return randomUUID();
}

export function getTimestampHeader(): string {
  return String(Math.floor(Date.now() / 1000));
}
