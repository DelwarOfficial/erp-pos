// Per-company SMS provider accounts.
//
// Each company brings its own MiMSMS account and Sender ID, so one company can
// never send -- or spend -- on another's. The credentials are stored encrypted
// (AES-256-GCM, src/lib/crypto) in integration_credentials under provider
// 'mimsms', label 'default', and are only ever decrypted inside the worker or
// an explicit test action. No API returns them; settings reads report whether
// an account is configured and its Sender ID only.

import { Prisma } from '@prisma/client';
import { decryptString, encryptString } from '@/lib/crypto';
import { DomainError } from '@/lib/errors/codes';
import type { SmsGateway } from './gateway';
import { MimSmsGateway, type MimSmsCredentials } from './mimsms';

export const SMS_PROVIDER = 'mimsms';
const LABEL = 'default';

type Client = Pick<Prisma.TransactionClient, 'integrationCredential'>;

export function validateMimSmsCredentials(input: Partial<MimSmsCredentials>): MimSmsCredentials {
  const userName = input.userName?.trim() ?? '';
  const apiKey = input.apiKey?.trim() ?? '';
  const senderName = input.senderName?.trim() ?? '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userName)) throw new DomainError('VALIDATION_FAILED', 'userName is the MiMSMS panel login email', {}, 400);
  if (apiKey.length < 8 || apiKey.length > 200) throw new DomainError('VALIDATION_FAILED', 'apiKey is not a MiMSMS API key', {}, 400);
  if (senderName.length < 3 || senderName.length > 20) throw new DomainError('VALIDATION_FAILED', 'senderName must be a registered Sender ID', {}, 400);
  return { userName, apiKey, senderName };
}

export async function saveSmsCredentials(tx: Client, companyId: string, createdBy: string, credentials: MimSmsCredentials) {
  const encrypted = encryptString(JSON.stringify(credentials));
  const ciphertext = new Uint8Array(encrypted.ciphertext);
  const keyVersion = encrypted.keyVersion;
  await tx.integrationCredential.upsert({
    where: { companyId_provider_label: { companyId, provider: SMS_PROVIDER, label: LABEL } },
    create: { companyId, provider: SMS_PROVIDER, label: LABEL, credentialCiphertext: ciphertext, keyVersion, status: 'active', createdBy },
    update: { credentialCiphertext: ciphertext, keyVersion, status: 'active', lastRotatedAt: new Date() },
  });
}

/** Whether an account is set, and its Sender ID -- never the key or login. */
export async function describeSmsAccount(tx: Client, companyId: string) {
  const row = await tx.integrationCredential.findFirst({
    where: { companyId, provider: SMS_PROVIDER, label: LABEL },
    select: { status: true, credentialCiphertext: true, keyVersion: true, lastRotatedAt: true },
  });
  if (!row) return { configured: false as const };
  const { senderName } = JSON.parse(decryptString(Buffer.from(row.credentialCiphertext), row.keyVersion)) as MimSmsCredentials;
  return { configured: true as const, active: row.status === 'active', provider: SMS_PROVIDER, senderName, updatedAt: row.lastRotatedAt };
}

/** The company's gateway, or null when it has no active account. */
export async function loadSmsGateway(tx: Client, companyId: string, fetchImpl?: typeof fetch): Promise<SmsGateway | null> {
  const row = await tx.integrationCredential.findFirst({
    where: { companyId, provider: SMS_PROVIDER, label: LABEL, status: 'active' },
    select: { credentialCiphertext: true, keyVersion: true },
  });
  if (!row) return null;
  const credentials = JSON.parse(decryptString(Buffer.from(row.credentialCiphertext), row.keyVersion)) as MimSmsCredentials;
  return new MimSmsGateway(credentials, fetchImpl);
}
