// src/lib/crypto/index.ts
// Envelope encryption for MFA secrets and provider credentials (§6).
//
// Production uses AWS KMS / GCP KMS to wrap a per-tenant DEK, which is then
// used to AES-256-GCM encrypt sensitive payloads. The sandbox simulates this
// with a single master key derived from APP_ENCRYPTION_KEY env var.

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from 'node:crypto';

const MASTER_KEY_ENV = process.env.APP_ENCRYPTION_KEY ?? 'sandbox-default-key-please-override-in-production';
const KEY_VERSION = 1;

function getMasterKey(): Buffer {
  return scryptSync(MASTER_KEY_ENV, 'erp-pos-salt-v1', 32);
}

export interface EncryptedPayload {
  ciphertext: Buffer;
  keyVersion: number;
  iv: Buffer;
  authTag: Buffer;
}

export function encrypt(plaintext: Buffer | string): EncryptedPayload {
  const key = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const buf = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, keyVersion: KEY_VERSION, iv, authTag };
}

export function decrypt(payload: EncryptedPayload): Buffer {
  if (payload.keyVersion !== KEY_VERSION) {
    throw new Error(`Unsupported key version: ${payload.keyVersion}`);
  }
  const key = getMasterKey();
  const decipher = createDecipheriv('aes-256-gcm', key, payload.iv);
  decipher.setAuthTag(payload.authTag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
}

export function encryptString(plaintext: string): { ciphertext: Buffer; keyVersion: number } {
  // For Prisma Bytes storage, we concatenate iv+authTag+ciphertext
  const enc = encrypt(plaintext);
  const combined = Buffer.concat([enc.iv, enc.authTag, enc.ciphertext]);
  return { ciphertext: combined, keyVersion: enc.keyVersion };
}

export function decryptString(ciphertext: Buffer, _keyVersion: number = KEY_VERSION): string {
  if (ciphertext.length < 28) throw new Error('Ciphertext too short');
  const iv = ciphertext.subarray(0, 12);
  const authTag = ciphertext.subarray(12, 28);
  const ct = ciphertext.subarray(28);
  const payload: EncryptedPayload = { ciphertext: ct, keyVersion: _keyVersion, iv, authTag };
  return decrypt(payload).toString('utf8');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256(key: string | Buffer, message: string): string {
  const hmac = createHmac('sha256', key);
  hmac.update(message);
  return hmac.digest('hex');
}

export function randomToken(bytes: number = 32): string {
  return randomBytes(bytes).toString('hex');
}
