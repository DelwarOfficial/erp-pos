// src/lib/auth/mfa.ts
// TOTP MFA per §6 rule 2.
// - Secret is envelope-encrypted at rest (encryptString).
// - Required for: owners, global admins, backup download, journal/adjustment
//   approval, sensitive export, fiscal-period actions, supervisor/cashier-
//   variance approval.

import { authenticator } from '@otplib/preset-default';
import { encryptString, decryptString } from '../crypto';

export interface MfaSetupResult {
  secret: string;       // plaintext — shown to user ONCE during setup
  otpauthUrl: string;
  ciphertext: Buffer;   // stored in DB
  keyVersion: number;
}

export function setupMfa(params: { userEmail: string; issuer?: string }): MfaSetupResult {
  const secret = authenticator.generateSecret();
  const issuer = params.issuer ?? 'ERP-POS';
  const otpauthUrl = authenticator.keyuri(params.userEmail, issuer, secret);
  const enc = encryptString(secret);
  return {
    secret,
    otpauthUrl,
    ciphertext: enc.ciphertext,
    keyVersion: enc.keyVersion,
  };
}

export function verifyMfaCode(ciphertext: Buffer, keyVersion: number, code: string): boolean {
  try {
    const secret = decryptString(ciphertext, keyVersion);
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

export function verifyMfaCodeForSecret(secret: string, code: string): boolean {
  return authenticator.verify({ token: code, secret });
}
