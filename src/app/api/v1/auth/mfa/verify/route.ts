// POST /api/v1/auth/mfa/verify
// Verifies a TOTP code submitted during login. On success, issues access+refresh.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { verifyMfaCode } from '@/lib/auth/mfa';
import { setAuthCookies, getMfaPendingCookie, clearMfaPendingCookie } from '@/lib/auth/sessions';
import { recordSecurityEvent } from '@/lib/audit';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId, getClientIp, getUserAgent } from '@/lib/http';
import { checkRateLimit, buildRateLimitKey, resetRateLimit, DEFAULT_MFA_LIMIT } from '@/lib/auth/rateLimiter';

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
    const rl = checkRateLimit(rlKey, DEFAULT_MFA_LIMIT);
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
    if (!user || !user.mfaEnabled || !user.mfaSecretCiphertext) {
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

    // Success — reset the rate limiter for this user
    resetRateLimit(rlKey);

    const branchIds = user.branchAccess.map(b => b.branchId);
    const sessionId = randomUUID();
    await setAuthCookies({
      userId: user.id,
      companyId: user.companyId,
      accessScope: user.accessScope,
      isGlobal: user.accessScope === 'global' && user.company.code === 'PLATFORM',
      branchIds,
      familyId: pending.familyId,
      sessionId,
      mfaVerified: true,
    });

    await clearMfaPendingCookie();

    await recordSecurityEvent({
      eventType: 'mfa_success',
      severity: 'info',
      metadata: { user_id: user.id, session_id: sessionId },
      companyId: user.companyId,
      userId: user.id,
      ip,
      userAgent: ua,
    });

    return NextResponse.json({
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
