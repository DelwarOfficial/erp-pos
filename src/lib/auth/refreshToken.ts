// src/lib/auth/refreshToken.ts
// Rotating refresh tokens per §6 rule 1.
// - Random, hashed at rest (sha256)
// - Device-bound
// - Family-based revocation: if a stale (already-rotated) token is reused,
//   the entire family is revoked + a high-severity security event is recorded.

import { randomBytes } from 'node:crypto';
import { sha256 } from '../crypto';
import { db } from '../db';
import { REFRESH_TOKEN_TTL_MS } from './jwt';

export interface IssuedRefreshToken {
  token: string;     // raw token — return to client, never store
  hash: string;      // sha256 hex
  expiresAt: Date;
  familyId: string;
  tokenId: string;
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
}): Promise<IssuedRefreshToken> {
  const { token, hash } = generateRefreshToken();
  const familyId = params.familyId ?? randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  const created = await db.refreshToken.create({
    data: {
      companyId: params.companyId,
      userId: params.userId,
      deviceId: params.deviceId ?? null,
      tokenHash: hash,
      familyId,
      expiresAt,
      rotatedFromId: params.rotatedFromId ?? null,
    },
  });
  return { token, hash, expiresAt, familyId, tokenId: created.id };
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
  const record = await db.refreshToken.findFirst({
    where: { tokenHash: presentedHash, companyId: params.companyId },
  });

  if (!record) {
    throw new Error('Refresh token not recognized');
  }

  if (record.revokedAt) {
    // REUSE of an already-rotated token → revoke the entire family.
    await db.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
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

  if (record.expiresAt < new Date()) {
    throw new Error('Refresh token expired');
  }

  // Rotate: revoke the current token, issue a new one in the same family.
  await db.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date(), revokeReason: 'rotated' },
  });

  return issueRefreshToken({
    companyId: params.companyId,
    userId: params.userId,
    deviceId: params.deviceId ?? record.deviceId ?? undefined,
    familyId: record.familyId,
    rotatedFromId: record.id,
  });
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
