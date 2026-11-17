// Courier webhook authentication, per courier.
//
// Each courier has its own credential, so one courier (or a leak of one
// courier's secret) cannot post status updates as another:
//
//   COURIER_WEBHOOK_SECRET_<PROVIDER>  signing secret. The courier sends
//       X-Courier-Timestamp (unix seconds) and
//       X-Courier-Signature = hex HMAC-SHA256(secret, "<timestamp>.<raw body>").
//       Requests older or newer than 5 minutes are refused (replay window).
//   COURIER_WEBHOOK_TOKEN_<PROVIDER>   for couriers that can only send a fixed
//       header: X-Courier-Token must equal it.
//
// <PROVIDER> is the provider code upper-cased, non-alphanumerics as "_"
// (pathao -> PATHAO). When a signing secret is set, the token is not accepted.
// The old shared COURIER_WEBHOOK_TOKEN is accepted only outside production,
// and only for a courier with no credential of its own.

import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_SKEW_SECONDS = 300;

export type CourierAuthResult = { ok: true; method: 'signature' | 'token' } | { ok: false; reason: string };

function same(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function courierEnvKey(provider: string): string {
  return provider.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

export function verifyCourierWebhook(
  provider: string,
  rawBody: string,
  headers: { token: string | null; timestamp: string | null; signature: string | null },
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): CourierAuthResult {
  const key = courierEnvKey(provider);
  const secret = env[`COURIER_WEBHOOK_SECRET_${key}`];
  if (secret) {
    if (!headers.timestamp || !headers.signature) return { ok: false, reason: 'signature_missing' };
    const ts = Number(headers.timestamp);
    if (!Number.isInteger(ts) || Math.abs(now.getTime() / 1000 - ts) > MAX_SKEW_SECONDS) return { ok: false, reason: 'timestamp_out_of_window' };
    const expected = createHmac('sha256', secret).update(`${headers.timestamp}.${rawBody}`).digest('hex');
    return same(headers.signature.toLowerCase(), expected) ? { ok: true, method: 'signature' } : { ok: false, reason: 'bad_signature' };
  }
  const token = env[`COURIER_WEBHOOK_TOKEN_${key}`]
    ?? (env.NODE_ENV !== 'production' ? env.COURIER_WEBHOOK_TOKEN : undefined);
  if (!token) return { ok: false, reason: 'no_credential_for_provider' };
  return headers.token && same(headers.token, token) ? { ok: true, method: 'token' } : { ok: false, reason: 'bad_token' };
}
