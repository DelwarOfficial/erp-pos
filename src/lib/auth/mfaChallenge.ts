import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { systemDb } from '@/lib/db';
import { DomainError } from '@/lib/errors/codes';

const TTL_MS = 5 * 60 * 1000;
const ACTION = 'password_mfa_login';
const payloadSchema = z.object({
  purpose: z.literal(ACTION),
  challengeId: z.string().uuid(),
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  userId: z.string().min(1),
  companyId: z.string().min(1),
  familyId: z.string().min(1),
  passwordAuthenticatedAt: z.number().int(),
  expiresAt: z.number().int(),
}).strict();
export type MfaLoginChallenge = z.infer<typeof payloadSchema>;

function signature(body: string): Buffer {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key && process.env.NODE_ENV === 'production') throw new Error('APP_ENCRYPTION_KEY must be set in production');
  return createHmac('sha256', key ?? 'local-only-mfa-challenge-key').update(`${ACTION}:${body}`).digest();
}

function nonceHash(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

function activeWhere(payload: MfaLoginChallenge) {
  return {
    id: payload.challengeId, companyId: payload.companyId, userId: payload.userId,
    action: ACTION, challenge: nonceHash(payload.nonce), consumedAt: null,
    expiresAt: { gt: new Date() },
    createdAt: new Date(payload.passwordAuthenticatedAt),
  };
}

/** Called only after password verification. The existing challenge store is
 * purpose-separated: WebAuthn queries use registration/assertion, never this action.
 * Only a nonce hash is persisted; the signed browser state contains no TOTP secret.
 */
export async function issueMfaChallenge(input: { userId: string; companyId: string; familyId: string }): Promise<string> {
  const now = Date.now();
  const payload: MfaLoginChallenge = {
    ...input, purpose: ACTION, challengeId: randomUUID(), nonce: randomBytes(32).toString('hex'),
    passwordAuthenticatedAt: now, expiresAt: now + TTL_MS,
  };
  await systemDb.webAuthnChallenge.create({ data: {
    id: payload.challengeId, companyId: input.companyId, userId: input.userId,
    action: ACTION, challenge: nonceHash(payload.nonce),
    createdAt: new Date(now), expiresAt: new Date(payload.expiresAt),
  } });
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${signature(body).toString('base64url')}`;
}

export async function readMfaChallenge(value: string | undefined): Promise<MfaLoginChallenge | null> {
  if (!value || value.length > 4096) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const expected = signature(parts[0]);
  const supplied = Buffer.from(parts[1], 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return null; }
  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success) return null;
  const payload = parsed.data;
  const now = Date.now();
  if (payload.passwordAuthenticatedAt > now || payload.expiresAt <= now
      || payload.expiresAt - payload.passwordAuthenticatedAt !== TTL_MS) return null;
  const row = await systemDb.webAuthnChallenge.findFirst({ where: activeWhere(payload), select: { id: true } });
  return row ? payload : null;
}

/** Compare-and-set: concurrent verifications can issue at most one session. */
export async function consumeMfaChallenge(payload: MfaLoginChallenge): Promise<void> {
  const result = await systemDb.webAuthnChallenge.updateMany({
    where: activeWhere(payload), data: { consumedAt: new Date() },
  });
  if (result.count !== 1) throw new DomainError('UNAUTHORIZED', 'MFA challenge expired or already used', {}, 401);
}
