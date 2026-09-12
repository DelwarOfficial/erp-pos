// src/lib/auth/refreshToken.ts
// Rotating refresh tokens per §6 rule 1.
// - Random, hashed at rest (sha256)
// - Device-bound
// - Family-based revocation: if a stale (already-rotated) token is reused,
//   the entire family is revoked + a high-severity security event is recorded.

import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { sha256 } from '../crypto';
import { systemDb as db } from '../db';
import { REFRESH_TOKEN_TTL_MS } from './jwt';

export interface IssuedRefreshToken {
  token: string;     // raw token — return to client, never store
  hash: string;      // sha256 hex
  expiresAt: Date;
  familyId: string;
  tokenId: string;
  sessionId: string | null;
  mfaVerified: boolean;
}

export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: sha256(token) };
}

export async function issueRefreshToken(params: {
  companyId: string;
  userId: string;
  deviceId?: string;
  familyId?: string;
  rotatedFromId?: string;
  sessionId?: string;
  mfaVerified?: boolean;
}, client: Prisma.TransactionClient = db): Promise<IssuedRefreshToken> {
  const { token, hash } = generateRefreshToken();
  const familyId = params.familyId ?? randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  const created = await client.refreshToken.create({
    data: {
      companyId: params.companyId,
      userId: params.userId,
      deviceId: params.deviceId ?? null,
      tokenHash: hash,
      familyId,
      sessionId: params.sessionId ?? null,
      mfaVerified: params.mfaVerified ?? false,
      expiresAt,
      rotatedFromId: params.rotatedFromId ?? null,
    },
  });
  return { token, hash, expiresAt, familyId, tokenId: created.id,
    sessionId: params.sessionId ?? null, mfaVerified: params.mfaVerified ?? false };
}

/**
 * Validate + rotate a refresh token. If the token has been revoked (already
 * rotated), revoke the entire family and emit a critical security event.
 *
 * Returns the new token on success. Throws on invalid/expired/reused.
 */
export async function rotateRefreshToken(params: {
  presentedToken: string;
  companyId: string;
  userId: string;
  deviceId?: string;
  ip?: string;
  userAgent?: string;
}): Promise<IssuedRefreshToken> {
  const presentedHash = sha256(params.presentedToken);
  const outcome = await db.$transaction(async tx => {
    const record = await tx.refreshToken.findFirst({
      where: { tokenHash: presentedHash, companyId: params.companyId, userId: params.userId },
    });
    if (!record) throw new Error('Refresh token not recognized');
    if (record.revokedAt) return { reused: record, token: null };
    if (record.expiresAt <= new Date()) throw new Error('Refresh token expired');
    const consumed = await tx.refreshToken.updateMany({
      where: { id: record.id, companyId: params.companyId, userId: params.userId,
        revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date(), revokeReason: 'rotated' },
    });
    if (consumed.count !== 1) return { reused: record, token: null };
    const token = await issueRefreshToken({
      companyId: params.companyId, userId: params.userId,
      deviceId: record.deviceId ?? undefined,
      familyId: record.familyId, rotatedFromId: record.id,
      sessionId: record.sessionId ?? undefined, mfaVerified: record.mfaVerified,
    }, tx);
    return { reused: null, token };
  }, { isolationLevel: 'Serializable' });

  if (outcome.reused) {
    const record = outcome.reused;
    // REUSE of an already-rotated token → revoke the entire family.
    await db.refreshToken.updateMany({
      where: { familyId: record.familyId, companyId: params.companyId, userId: params.userId, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokeReason: 'family_reuse_detected',
      },
    });
    await db.securityEvent.create({
      data: {
        companyId: params.companyId,
        userId: record.userId,
        deviceId: record.deviceId ?? null,
        eventType: 'refresh_token_reuse',
        severity: 'critical',
        ipAddress: params.ip ?? null,
        userAgent: params.userAgent ?? null,
        metadata: JSON.stringify({
          family_id: record.familyId,
          reused_token_id: record.id,
        }),
      },
    });
    throw new Error('Refresh token reuse detected — family revoked');
  }

  if (!outcome.token) throw new Error('Refresh rotation failed');
  return outcome.token;
}

export async function revokeFamily(params: {
  companyId: string;
  familyId: string;
  reason: string;
}): Promise<void> {
  await db.refreshToken.updateMany({
    where: { familyId: params.familyId, companyId: params.companyId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: params.reason },
  });
}

export async function revokeUserSessions(params: {
  companyId: string;
  userId: string;
  reason: string;
}): Promise<void> {
  await db.refreshToken.updateMany({
    where: { userId: params.userId, companyId: params.companyId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: params.reason },
  });
}
