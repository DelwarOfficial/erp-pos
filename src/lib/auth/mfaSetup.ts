// src/lib/auth/mfaSetup.ts
// Initial MFA enrollment state for privileged users whose password is valid
// but MFA was never enrolled (bootstrap deadlock otherwise).
//
// Security model:
// - Enrollment state is issued ONLY after password verification (login route).
// - The cookie value is HMAC-signed with the server secret; the server never
//   trusts unsigned client state. Signature uses timing-safe comparison.
// - Short-lived (10 min). Bound to one user + company + family + setupToken.
// - The TOTP secret is generated server-side via existing setupMfa() and its
//   ENVELOPE-ENCRYPTED ciphertext travels inside the signed cookie — plaintext
//   secrets are never stored anywhere except the one-time setup response.
// - Activation requires a valid CURRENT TOTP code proving possession. Only then
//   is mfaEnabled set true and the ciphertext persisted to the User row.
// - Single-use: the setup cookie is cleared on success, and activation
//   re-checks !mfaEnabled, so replay cannot re-enroll or overwrite.
// - Failures are rate-limited (caller) and audited via security events.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hmacSha256 } from '../crypto';

export const MFA_SETUP_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface MfaSetupPayload {
  /** Discriminator so MFA-challenge cookies cannot be replayed as setup cookies. */
  kind: 'mfa_setup';
  userId: string;
  companyId: string;
  familyId: string;
  /** Single-use token binding this state to the password-verified login. */
  setupToken: string;
  /** Hex of the envelope-encrypted TOTP secret; present after challenge issued. */
  enc?: string;
  iat: number;
  exp: number;
}

function setupSignKey(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('APP_ENCRYPTION_KEY must be set in production');
    }
    return 'sandbox-dev-setup-sign-key';
  }
  return key;
}

function b64urlEncode(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function b64urlDecode(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf8');
}

/** Create a fresh signed enrollment state. No secret embedded yet. */
export function createSetupState(params: {
  userId: string;
  companyId: string;
  familyId: string;
}): { cookieValue: string; payload: MfaSetupPayload } {
  const now = Date.now();
  const payload: MfaSetupPayload = {
    kind: 'mfa_setup',
    userId: params.userId,
    companyId: params.companyId,
    familyId: params.familyId,
    setupToken: randomBytes(32).toString('hex'),
    iat: now,
    exp: now + MFA_SETUP_TTL_MS,
  };
  return { cookieValue: signSetupPayload(payload), payload };
}

/** Embed the encrypted secret after challenge generation; preserves binding. */
export function attachSetupSecret(
  payload: MfaSetupPayload,
  encHex: string,
): { cookieValue: string; payload: MfaSetupPayload } {
  const next: MfaSetupPayload = { ...payload, enc: encHex };
  return { cookieValue: signSetupPayload(next), payload: next };
}

export function signSetupPayload(payload: MfaSetupPayload): string {
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = hmacSha256(setupSignKey(), body);
  return `${body}.${sig}`;
}

/** Verify signature, shape, discriminator, and expiry. Returns null if invalid. */
export function verifySetupCookieValue(value: string | null | undefined): MfaSetupPayload | null {
  if (!value || typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecode(body));
  } catch {
    return null;
  }
  const expected = hmacSha256(setupSignKey(), body);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (p.kind !== 'mfa_setup') return null;
  if (
    typeof p.userId !== 'string' ||
    typeof p.companyId !== 'string' ||
    typeof p.familyId !== 'string' ||
    typeof p.setupToken !== 'string' ||
    typeof p.exp !== 'number'
  ) {
    return null;
  }
  if (Date.now() > p.exp) return null;
  if (p.enc !== undefined && typeof p.enc !== 'string') return null;
  return {
    kind: 'mfa_setup',
    userId: p.userId,
    companyId: p.companyId,
    familyId: p.familyId,
    setupToken: p.setupToken,
    enc: p.enc,
    iat: typeof p.iat === 'number' ? p.iat : 0,
    exp: p.exp,
  };
}
