// src/lib/auth/enrollment.ts
// Initial MFA enrollment orchestration (DB + crypto). Route handlers are thin
// wrappers that move cookieValue in/out of HTTP cookies.
//
// Flow (all steps require the HMAC-signed setup state created at login,
// which itself requires a verified password):
//   1. issueEnrollment(user)        — after password OK, privileged + !mfaEnabled
//   2. getEnrollmentChallenge(cookie) — generates TOTP secret via setupMfa(),
//      embeds its ciphertext in refreshed signed state, returns otpauthUrl +
//      manual key to display ONCE.
//   3. activateEnrollment(cookie, code) — verifies current TOTP code; only then
//      persists ciphertext + mfaEnabled=true, clears setup state (caller must
//      delete the cookie), and issues the normal authenticated session.
//

import { randomUUID } from 'node:crypto';
import { systemDb as db } from '@/lib/db';
import { setupMfa, verifyMfaCode } from './mfa';
import { setAuthCookies, type CookieAuthResult } from './sessions';
import {
  createSetupState,
  attachSetupSecret,
  verifySetupCookieValue,
  type MfaSetupPayload,
} from './mfaSetup';
import { checkRateLimit, buildRateLimitKey, resetRateLimit, DEFAULT_MFA_LIMIT } from './rateLimiter';
import { recordSecurityEvent } from '@/lib/audit';
import { DomainError } from '@/lib/errors/codes';

export interface EnrollmentContext {
  ip?: string;
  userAgent?: string;
}

type IssueSession = typeof setAuthCookies;

async function loadEnrollableUser(payload: MfaSetupPayload) {
  const user = await db.user.findFirst({
    where: { id: payload.userId, companyId: payload.companyId, deletedAt: null },
    include: { company: true, branchAccess: true },
  });
  // Re-check at USE time: already-enrolled users can never (re-)enroll here.
  if (!user || !user.isActive || user.company.status !== 'active' || user.mfaEnabled || user.mfaSecretCiphertext
    || user.passwordChangedAt.getTime() > payload.iat) {
    return null;
  }
  return user;
}

/**
 * Called from login after password verification for privileged users without
 * MFA. Returns the signed setup cookie value (route sets it as HttpOnly).
 */
export async function issueEnrollment(
  params: { userId: string; companyId: string; ctx?: EnrollmentContext },
): Promise<{ cookieValue: string; familyId: string }> {
  const familyId = randomUUID();
  const { cookieValue } = createSetupState({
    userId: params.userId,
    companyId: params.companyId,
    familyId,
  });
  await recordSecurityEvent({
    eventType: 'login_mfa_setup_issued',
    severity: 'info',
    metadata: { user_id: params.userId, family_id: familyId },
    companyId: params.companyId,
    userId: params.userId,
    ip: params.ctx?.ip,
    userAgent: params.ctx?.userAgent,
  });
  return { cookieValue, familyId };
}

/**
 * Generate the TOTP secret and return the one-time display material plus a
 * refreshed signed cookie embedding the encrypted secret.
 */
export async function getEnrollmentChallenge(
  cookieValue: string | null | undefined,
  ctx?: EnrollmentContext,
): Promise<{ otpauthUrl: string; manualKey: string; cookieValue: string }> {
  const payload = verifySetupCookieValue(cookieValue);
  if (!payload) {
    throw new DomainError('UNAUTHORIZED', 'No MFA enrollment in progress', {}, 401);
  }
  const user = await loadEnrollableUser(payload);
  if (!user) {
    throw new DomainError('INVALID_MFA', 'MFA enrollment is not available for this user', {}, 400);
  }
  const setup = setupMfa({ userEmail: user.email });
  const refreshed = attachSetupSecret(payload, setup.ciphertext.toString('hex'));
  await recordSecurityEvent({
    eventType: 'mfa_setup_secret_issued',
    severity: 'info',
    metadata: { user_id: user.id, family_id: payload.familyId },
    companyId: user.companyId,
    userId: user.id,
    ip: ctx?.ip,
    userAgent: ctx?.userAgent,
  });
  return { otpauthUrl: setup.otpauthUrl, manualKey: setup.secret, cookieValue: refreshed.cookieValue };
}

export interface ActivationResult {
  user: {
    id: string;
    name: string;
    email: string;
    company_id: string;
    company_code: string;
    company_name: string;
    access_scope: string;
    branch_ids: string[];
  };
  session: CookieAuthResult;
  access_token_expires_in: number;
}

/**
 * Verify the enrollment TOTP code and activate MFA. Single-use: succeeds at
 * most once per user (mfaEnabled re-check) and the caller MUST clear the
 * setup cookie afterwards so the state cannot be replayed.
 */
export async function activateEnrollment(
  cookieValue: string | null | undefined,
  code: string,
  ctx?: EnrollmentContext,
  deps?: { issueSession?: IssueSession },
): Promise<ActivationResult> {
  const payload = verifySetupCookieValue(cookieValue);
  if (!payload || !payload.enc) {
    throw new DomainError('UNAUTHORIZED', 'No MFA enrollment in progress', {}, 401);
  }

  const rlKey = buildRateLimitKey('mfa_setup_activate', ctx?.ip, payload.userId);
  const rl = checkRateLimit(rlKey, DEFAULT_MFA_LIMIT);
  if (!rl.allowed) {
    await recordSecurityEvent({
      eventType: 'mfa_setup_rate_limited',
      severity: 'warning',
      metadata: { user_id: payload.userId },
      companyId: payload.companyId,
      userId: payload.userId,
      ip: ctx?.ip,
      userAgent: ctx?.userAgent,
    });
    throw new DomainError('RATE_LIMITED', 'Too many MFA setup attempts. Please try again later.', {}, 429);
  }

  if (!/^\d{6}$/.test(code)) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid MFA code format', {}, 400);
  }

  const user = await loadEnrollableUser(payload);
  if (!user) {
    throw new DomainError('INVALID_MFA', 'MFA enrollment is not available for this user', {}, 400);
  }

  const ok = verifyMfaCode(Buffer.from(payload.enc, 'hex'), 1, code);
  if (!ok) {
    await recordSecurityEvent({
      eventType: 'mfa_setup_failed',
      severity: 'warning',
      metadata: { user_id: user.id, remaining_attempts: rl.remaining - 1 },
      companyId: user.companyId,
      userId: user.id,
      ip: ctx?.ip,
      userAgent: ctx?.userAgent,
    });
    throw new DomainError(
      'INVALID_MFA',
      `Invalid MFA code. ${rl.remaining - 1} attempts remaining.`,
      { remaining: rl.remaining - 1 },
      401,
    );
  }

  resetRateLimit(rlKey);

  // Persist encrypted secret + enable, atomically guarded by the re-check above
  // (a replayed request finds mfaEnabled=true and is rejected before writing).
  const activation = await db.user.updateMany({
    where: { id: user.id, companyId: user.companyId, isActive: true, deletedAt: null,
      mfaEnabled: false, mfaSecretCiphertext: null, passwordChangedAt: { lte: new Date(payload.iat) } },
    data: {
      mfaSecretCiphertext: Buffer.from(payload.enc, 'hex'),
      mfaEnabled: true,
    },
  });

  if (activation.count !== 1) {
    throw new DomainError('UNAUTHORIZED', 'MFA enrollment was already consumed or user is inactive', {}, 401);
  }

  const branchIds = user.branchAccess.map((b) => b.branchId);
  const sessionId = randomUUID();
  const issueSession = deps?.issueSession ?? setAuthCookies;
  const session = await issueSession({
    userId: user.id,
    companyId: user.companyId,
    accessScope: user.accessScope,
    isGlobal: user.accessScope === 'global' && user.company.code === 'PLATFORM',
    branchIds,
    familyId: payload.familyId,
    sessionId,
    mfaVerified: true,
  });

  await recordSecurityEvent({
    eventType: 'mfa_setup_completed',
    severity: 'info',
    metadata: { user_id: user.id, family_id: payload.familyId, session_id: sessionId },
    companyId: user.companyId,
    userId: user.id,
    ip: ctx?.ip,
    userAgent: ctx?.userAgent,
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      company_id: user.companyId,
      company_code: user.company.code,
      company_name: user.company.displayName,
      access_scope: user.accessScope,
      branch_ids: branchIds,
    },
    session,
    access_token_expires_in: 900,
  };
}
