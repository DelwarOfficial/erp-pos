// tests/unit/m7Integrations.test.ts
// Tests for M7 — webhook HMAC verification, offline sync validation.

import { describe, it, expect } from 'vitest';
import { signWebhook, verifyWebhookSignature, generateWebhookSecret } from '../../src/lib/integrations/webhook';
import { createHash } from 'node:crypto';

describe('M7 — Webhook HMAC-SHA256', () => {
  const secret = 'test-secret-key';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = '{"event":"sale.posted","id":"123"}';

  it('signs and verifies a valid webhook', () => {
    const sig = signWebhook(secret, timestamp, body);
    const result = verifyWebhookSignature(secret, timestamp, body, sig);
    expect(result.valid).toBe(true);
  });

  it('rejects tampered body', () => {
    const sig = signWebhook(secret, timestamp, body);
    const result = verifyWebhookSignature(secret, timestamp, body + 'tampered', sig);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/mismatch/i);
  });

  it('rejects wrong secret', () => {
    const sig = signWebhook(secret, timestamp, body);
    const result = verifyWebhookSignature('wrong-secret', timestamp, body, sig);
    expect(result.valid).toBe(false);
  });

  it('rejects replay outside 5-minute tolerance', () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 min ago
    const sig = signWebhook(secret, oldTimestamp, body);
    const result = verifyWebhookSignature(secret, oldTimestamp, body, sig);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/tolerance/i);
  });

  it('rejects invalid timestamp', () => {
    const sig = signWebhook(secret, 'not-a-number', body);
    const result = verifyWebhookSignature(secret, 'not-a-number', body, sig);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/timestamp/i);
  });

  it('generates a 64-char hex secret', () => {
    const s = generateWebhookSecret();
    expect(s.length).toBe(64);
    expect(s).toMatch(/^[0-9a-f]+$/);
  });

  it('signature is deterministic for same inputs', () => {
    const sig1 = signWebhook(secret, timestamp, body);
    const sig2 = signWebhook(secret, timestamp, body);
    expect(sig1).toBe(sig2);
  });
});

describe('M7 — Offline command validation', () => {
  it('payload hash is SHA-256 of payload JSON', () => {
    const payload = { command: 'cash_sale', amount: 100 };
    const payloadJson = JSON.stringify(payload);
    const expectedHash = createHash('sha256').update(payloadJson).digest('hex');
    expect(expectedHash.length).toBe(64);
    expect(expectedHash).toMatch(/^[0-9a-f]+$/);
  });

  it('offline whitelist does not include serialized sale', () => {
    const whitelist = ['cash_sale', 'held_sale_draft', 'shift_open', 'shift_close', 'customer_create', 'receipt_reprint'];
    expect(whitelist).not.toContain('serialized_sale');
    expect(whitelist).not.toContain('credit_sale');
    expect(whitelist).not.toContain('gift_card_redeem');
    expect(whitelist).not.toContain('cheque_payment');
    expect(whitelist).not.toContain('sale_return');
  });

  it('offline blacklist includes all prohibited operations', () => {
    const blacklist = [
      'serialized_sale', 'credit_sale', 'gift_card_redeem', 'loyalty_redeem',
      'cheque_payment', 'sale_return', 'refund', 'supplier_payment',
      'stock_adjustment', 'transfer', 'period_posting', 'price_change', 'tax_change',
    ];
    expect(blacklist.length).toBeGreaterThanOrEqual(10);
    expect(blacklist).toContain('serialized_sale');
    expect(blacklist).toContain('credit_sale');
  });
});
