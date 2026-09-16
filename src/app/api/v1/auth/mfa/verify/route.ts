// POST /api/v1/auth/mfa/verify
// Verifies a TOTP code submitted during login. On success, issues access+refresh.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { systemDb as db } from '@/lib/db';
import { verifyMfaCode } from '@/lib/auth/mfa';
import { consumeMfaChallenge } from '@/lib/auth/mfaChallenge';
import { setAuthCookies, getMfaPendingCookie, applyCookiesToResponse } from '@/lib/auth/sessions';
import { MFA_PENDING_COOKIE_NAME } from '@/lib/auth/cookieNames';
import { recordSecurityEvent } from '@/lib/audit';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId, getClientIp, getUserAgent } from '@/lib/http';
import { buildRateLimitKey, resetRateLimit, DEFAULT_MFA_LIMIT } from '@/lib/auth/rateLimiter';
import { checkDistributedRateLimit, resetDistributedRateLimit } from '@/lib/auth/distributedRateLimiter';
import { issueRefreshToken } from '@/lib/auth/refreshToken';

const MfaSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  const ip = getClientIp(req);
  const ua = getUserAgent(req);

  try {
    const pending = await getMfaPendingCookie();
    if (!pending) {
      throw new DomainError('UNAUTHORIZED', 'No MFA challenge in progress', {}, 401);
    }

    // Rate limit: 5 attempts per 5 min, then 15-min lock with progressive backoff
    const rlKey = buildRateLimitKey('mfa_verify', ip, pending.userId);
    const rl = await checkDistributedRateLimit('mfa-verify', rlKey, DEFAULT_MFA_LIMIT);
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
      return NextResponse.json(
        {
          error: { code: 'RATE_LIMITED', message: 'Too many MFA attempts. Please try again later.', retry_after_seconds: retryAfterSec },
          correlation_id: correlationId,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSec), 'X-RateLimit-Remaining': '0' },
        },
      );
    }

    const { code } = MfaSchema.parse(await req.json());

    const user = await db.user.findFirst({
      where: { id: pending.userId, companyId: pending.companyId, deletedAt: null },
      include: { company: true, branchAccess: true },
    });
    if (!user || !user.isActive || user.company.status !== 'active' || !user.mfaEnabled || !user.mfaSecretCiphertext) {
      throw new DomainError('INVALID_MFA', 'MFA not enabled for this user', {}, 400);
    }

    const ok = verifyMfaCode(Buffer.from(user.mfaSecretCiphertext), 1, code);
    if (!ok) {
      await recordSecurityEvent({
        eventType: 'mfa_failed',
        severity: 'warning',
        metadata: { user_id: user.id, remaining_attempts: rl.remaining - 1 },
        companyId: user.companyId,
        userId: user.id,
        ip,
        userAgent: ua,
      });
      throw new DomainError('INVALID_MFA', `Invalid MFA code. ${rl.remaining - 1} attempts remaining.`, { remaining: rl.remaining - 1 }, 401);
    }

    // Irreversible CAS first: any subsequent failure requires a new password challenge.
    await consumeMfaChallenge(pending);
    const branchIds = user.branchAccess.map(b => b.branchId);
    const sessionId = randomUUID();
    // Prepare cookies and audit within the session transaction. No cookies escape on rollback.
    const mfaResponse = await db.$transaction(async tx => {
      const refreshToken = await issueRefreshToken({ companyId: user.companyId, userId: user.id,
        familyId: pending.familyId, sessionId, mfaVerified: true }, tx);
      const mfaResult = await setAuthCookies({
        rotatedRefreshToken: refreshToken,
        writeCookies: false,
        userId: user.id,
        companyId: user.companyId,
        accessScope: user.accessScope,
        isGlobal: user.accessScope === 'global' && user.company.code === 'PLATFORM',
        branchIds,
        familyId: pending.familyId,
        sessionId,
        mfaVerified: true,
      });

      await tx.securityEvent.create({ data: {
        eventType: 'mfa_success',
        severity: 'info',
        metadata: JSON.stringify({ user_id: user.id, session_id: sessionId }),
        companyId: user.companyId,
        userId: user.id,
        ipAddress: ip,
        userAgent: ua,
      } });

      const response = NextResponse.json({
        mfa_required: false,
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
        access_token_expires_in: 900,
      });
      applyCookiesToResponse(response, mfaResult);
      response.cookies.delete(MFA_PENDING_COOKIE_NAME);
      return response;
    });
    resetRateLimit(rlKey);
    if (!(await resetDistributedRateLimit('mfa-verify', rlKey))) {
      // Session is already issued. Keep distributed quota until expiry; no retry/reissue.
      console.warn('[auth] MFA rate-limit cleanup unavailable; quota retained until expiry');
    }
    return mfaResponse;
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(
        new DomainError('VALIDATION_FAILED', 'Invalid MFA payload', { issues: e.issues }, 400),
        correlationId,
      );
    }
    if (e instanceof DomainError) return errorResponse(e, correlationId);
    return errorResponse(e, correlationId);
  }
}
