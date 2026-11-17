// Courier webhooks authenticate per courier: a signed body, or that courier's own token.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyCourierWebhook } from '@/lib/webhooks/courierAuth';

const now = new Date('2026-11-17T10:00:00Z');
const ts = String(Math.floor(now.getTime() / 1000));
const body = '{"consignment_id":"C-1","status":"delivered"}';
const sign = (secret: string, t = ts, b = body) => createHmac('sha256', secret).update(`${t}.${b}`).digest('hex');
const none = { token: null, timestamp: null, signature: null };

describe('verifyCourierWebhook', () => {
  const env = { NODE_ENV: 'production', COURIER_WEBHOOK_SECRET_PATHAO: 'pathao-secret', COURIER_WEBHOOK_TOKEN_REDX: 'redx-token', COURIER_WEBHOOK_TOKEN: 'shared' } as never;

  it('accepts a correctly signed, fresh body', () => {
    expect(verifyCourierWebhook('pathao', body, { ...none, timestamp: ts, signature: sign('pathao-secret') }, env, now)).toEqual({ ok: true, method: 'signature' });
  });

  it('refuses a tampered body, a stale timestamp, or a token where a signature is required', () => {
    expect(verifyCourierWebhook('pathao', body + ' ', { ...none, timestamp: ts, signature: sign('pathao-secret') }, env, now).ok).toBe(false);
    const old = String(Number(ts) - 301);
    expect(verifyCourierWebhook('pathao', body, { ...none, timestamp: old, signature: sign('pathao-secret', old) }, env, now)).toEqual({ ok: false, reason: 'timestamp_out_of_window' });
    expect(verifyCourierWebhook('pathao', body, { ...none, token: 'pathao-secret' }, env, now).ok).toBe(false);
  });

  it("does not let one courier's credential pass as another's", () => {
    expect(verifyCourierWebhook('redx', body, { ...none, token: 'redx-token' }, env, now)).toEqual({ ok: true, method: 'token' });
    expect(verifyCourierWebhook('steadfast', body, { ...none, token: 'redx-token' }, env, now).ok).toBe(false);
  });

  it('ignores the old shared token in production, accepts it in development', () => {
    expect(verifyCourierWebhook('steadfast', body, { ...none, token: 'shared' }, env, now)).toEqual({ ok: false, reason: 'no_credential_for_provider' });
    expect(verifyCourierWebhook('steadfast', body, { ...none, token: 'shared' }, { NODE_ENV: 'development', COURIER_WEBHOOK_TOKEN: 'shared' } as never, now).ok).toBe(true);
  });
});
