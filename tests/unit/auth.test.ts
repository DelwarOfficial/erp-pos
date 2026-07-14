// tests/unit/auth.test.ts
// Tests for:
//   - Password hashing with Argon2id
//   - JWT issue/verify round-trip
//   - Refresh token rotation: reuse → family revoked
//   - MFA setup + verify round-trip
//   - Progressive lockout thresholds

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword, getLockoutDuration } from '../../src/lib/auth/password';
import { issueAccessToken, verifyAccessToken } from '../../src/lib/auth/jwt';
import { issueRefreshToken, rotateRefreshToken } from '../../src/lib/auth/refreshToken';
import { setupMfa, verifyMfaCode } from '../../src/lib/auth/mfa';
import { authenticator } from '@otplib/preset-default';
import { seedPermissions } from '../../src/lib/permissions/catalogue';

const db = new PrismaClient();

let companyId: string;
let userId: string;

beforeAll(async () => {
  await db.$connect();
  await seedPermissions();
  const company = await db.company.create({
    data: {
      code: 'TEST-AUTH-' + Date.now(),
      legalName: 'Auth Test Co',
      displayName: 'Auth Test',
      baseCurrencyCode: 'BDT',
      status: 'active',
    },
  });
  companyId = company.id;
  const user = await db.user.create({
    data: {
      companyId,
      name: 'Auth Test',
      email: 'auth-' + Date.now() + '@test.local',
      passwordHash: await hashPassword('TestPassword123!'),
      accessScope: 'single_branch',
    },
  });
  userId = user.id;
});

afterAll(async () => {
  if (companyId) {
    await db.refreshToken.deleteMany({ where: { companyId } });
    await db.securityEvent.deleteMany({ where: { companyId } });
  }
  if (userId) await db.user.deleteMany({ where: { id: userId } });
  if (companyId) {
    await db.company.deleteMany({ where: { id: companyId } });
  }
  await db.$disconnect();
});

describe('password hashing', () => {
  it('hashes with Argon2id and verifies correctly', async () => {
    const hash = await hashPassword('Hello123!');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'Hello123!')).toBe(true);
    expect(await verifyPassword(hash, 'WrongPassword')).toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const a = await hashPassword('Same123!');
    const b = await hashPassword('Same123!');
    expect(a).not.toBe(b);
  });
});

describe('progressive lockout', () => {
  it('does not lock for <5 failures', () => {
    const { lockUntil, lockMinutes } = getLockoutDuration(4);
    expect(lockUntil).toBeNull();
    expect(lockMinutes).toBeNull();
  });

  it('locks for 5 minutes at 5 failures', () => {
    const { lockMinutes } = getLockoutDuration(5);
    expect(lockMinutes).toBe(5);
  });

  it('locks for 30 minutes at 10 failures', () => {
    const { lockMinutes } = getLockoutDuration(10);
    expect(lockMinutes).toBe(30);
  });

  it('locks for 4 hours at 15 failures', () => {
    const { lockMinutes } = getLockoutDuration(15);
    expect(lockMinutes).toBe(240);
  });

  it('locks for 24 hours at 20+ failures', () => {
    const { lockMinutes } = getLockoutDuration(20);
    expect(lockMinutes).toBe(1440);
    expect(getLockoutDuration(50).lockMinutes).toBe(1440);
  });
});

describe('JWT', () => {
  it('issues and verifies an access token', async () => {
    const claims = {
      sub: userId,
      company_id: companyId,
      scope: 'single_branch',
      is_global: false,
      branch_ids: [],
      session_id: 'test-session',
      family_id: 'test-family',
      mfa_verified: true,
    };
    const token = await issueAccessToken(claims);
    expect(token.split('.').length).toBe(3); // header.payload.signature

    const verified = await verifyAccessToken(token);
    expect(verified.sub).toBe(userId);
    expect(verified.company_id).toBe(companyId);
    expect(verified.mfa_verified).toBe(true);
    expect(verified.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a tampered token', async () => {
    const token = await issueAccessToken({
      sub: userId, company_id: companyId, scope: 'single_branch',
      is_global: false, branch_ids: [], session_id: 's', family_id: 'f', mfa_verified: false,
    });
    const tampered = token.slice(0, -5) + 'XXXXX';
    await expect(verifyAccessToken(tampered)).rejects.toThrow();
  });
});

describe('refresh token rotation', () => {
  it('issues a refresh token and rotates it', async () => {
    const issued = await issueRefreshToken({ companyId, userId });
    expect(issued.token.length).toBe(64); // 32 bytes hex

    const rotated = await rotateRefreshToken({
      presentedToken: issued.token,
      companyId,
      userId,
    });
    expect(rotated.token).not.toBe(issued.token);
    expect(rotated.familyId).toBe(issued.familyId);
    expect(rotated.rotatedFromId ?? rotated.tokenId).toBeDefined();
  });

  it('revokes the entire family when a stale (already-rotated) token is reused', async () => {
    const issued = await issueRefreshToken({ companyId, userId });
    // Rotate once
    const rotated = await rotateRefreshToken({
      presentedToken: issued.token, companyId, userId,
    });
    // Now try to reuse the OLD token — should trigger family revocation
    await expect(
      rotateRefreshToken({ presentedToken: issued.token, companyId, userId }),
    ).rejects.toThrow(/Refresh token reuse detected/);

    // The newly-rotated token should also be revoked (family-wide)
    await expect(
      rotateRefreshToken({ presentedToken: rotated.token, companyId, userId }),
    ).rejects.toThrow(/Refresh token reuse detected|Refresh token not recognized/);

    // A security event should have been recorded
    const events = await db.securityEvent.findMany({
      where: { companyId, eventType: 'refresh_token_reuse' },
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].severity).toBe('critical');
  });
});

describe('MFA', () => {
  it('sets up MFA, encrypts the secret, and verifies a code from the same secret', () => {
    const setup = setupMfa({ userEmail: 'mfa@test.local' });
    expect(setup.secret.length).toBeGreaterThanOrEqual(16);
    expect(setup.ciphertext.length).toBeGreaterThan(28);
    expect(setup.keyVersion).toBe(1);
    expect(setup.otpauthUrl).toContain('otpauth://totp/');

    // Generate a code from the plaintext secret and verify
    const code = authenticator.generate(setup.secret);
    expect(verifyMfaCode(setup.ciphertext, setup.keyVersion, code)).toBe(true);

    // Wrong code fails
    expect(verifyMfaCode(setup.ciphertext, setup.keyVersion, '000000')).toBe(false);
  });
});
