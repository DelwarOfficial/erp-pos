// POST /api/v1/auth/mfa/step-up
// Re-checks the signed-in user's authenticator code mid-session. On success the
// session counts as MFA-verified for MFA_STEP_UP_WINDOW_MS (src/lib/auth/requireMfa.ts),
// so the sensitive action that asked for it can be retried (red-team workstream 5).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { systemDb as db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { verifyMfaCode } from '@/lib/auth/mfa';
import { MFA_STEP_UP_WINDOW_MS } from '@/lib/auth/requireMfa';
import { recordSecurityEvent } from '@/lib/audit';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId, getClientIp, getUserAgent } from '@/lib/http';
import { buildRateLimitKey, DEFAULT_MFA_LIMIT } from '@/lib/auth/rateLimiter';
import { AUTH_UNAVAILABLE_MESSAGE, checkDistributedRateLimit, resetDistributedRateLimit } from '@/lib/auth/distributedRateLimiter';

const StepUpSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  const ip = getClientIp(req);
  const ua = getUserAgent(req);
  try {
    const auth = await authenticateRequest();

    // Same limit as the sign-in challenge: 5 attempts per 5 minutes.
    const rlKey = buildRateLimitKey('mfa_step_up', ip, auth.userId);
    const rl = await checkDistributedRateLimit('mfa-step-up', rlKey, DEFAULT_MFA_LIMIT);
    if (rl.unavailable) {
      return NextResponse.json({ error: { code: 'AUTH_SERVICE_UNAVAILABLE', message: AUTH_UNAVAILABLE_MESSAGE }, correlation_id: correlationId }, { status: 503 });
    }
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
      return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a few minutes, then try again.', retry_after_seconds: retryAfterSec }, correlation_id: correlationId },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } });
    }

    const { code } = StepUpSchema.parse(await req.json());
    const user = await runInTenantContext(auth.ctx, () =>
      db.user.findFirst({ where: { id: auth.userId, companyId: auth.companyId, deletedAt: null }, select: { id: true, mfaEnabled: true, mfaSecretCiphertext: true } }));
    if (!user?.mfaEnabled || !user.mfaSecretCiphertext) {
      throw new DomainError('VALIDATION_FAILED', 'Two-step sign-in is not set up for your account. Set it up first, then try again.', { mfa_setup_required: true }, 409);
    }
    if (!verifyMfaCode(Buffer.from(user.mfaSecretCiphertext), 1, code)) {
      await recordSecurityEvent({ eventType: 'mfa_step_up_failed', severity: 'warning', metadata: { user_id: user.id, remaining_attempts: rl.remaining - 1 },
        companyId: auth.companyId, userId: user.id, ip, userAgent: ua });
      // 400, not 401: a wrong code is not an ended session.
      throw new DomainError('INVALID_MFA', `That code didn't match. ${rl.remaining - 1} attempts left.`, { remaining: rl.remaining - 1 }, 400);
    }

    const verifiedAt = new Date();
    await runInTenantContext(auth.ctx, () => db.refreshToken.updateMany({
      where: { familyId: auth.familyId, userId: auth.userId, companyId: auth.companyId, revokedAt: null, expiresAt: { gt: verifiedAt } },
      data: { mfaVerified: true, mfaVerifiedAt: verifiedAt },
    }));
    await resetDistributedRateLimit('mfa-step-up', rlKey);
    await recordSecurityEvent({ eventType: 'mfa_step_up_success', severity: 'info', metadata: { user_id: user.id, session_id: auth.sessionId },
      companyId: auth.companyId, userId: user.id, ip, userAgent: ua });
    return NextResponse.json({ verified: true, valid_until: new Date(verifiedAt.getTime() + MFA_STEP_UP_WINDOW_MS).toISOString() });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Enter the 6-digit code', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
