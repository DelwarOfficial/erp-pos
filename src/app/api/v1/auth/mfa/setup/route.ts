// GET /api/v1/auth/mfa/setup
// Issues the one-time TOTP enrollment challenge for a password-verified
// privileged user without MFA. Requires the HMAC-signed setup cookie created
// at login. Returns the otpauth URI + manual key to display ONCE.

import { NextRequest, NextResponse } from 'next/server';
import { getMfaSetupCookie, setMfaSetupCookie, getMfaSetupCookieName } from '@/lib/auth/sessions';
import { getEnrollmentChallenge } from '@/lib/auth/enrollment';
import { DomainError, errorResponse, toDomainError } from '@/lib/errors/codes';
import { getCorrelationId, getClientIp, getUserAgent } from '@/lib/http';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  const ip = getClientIp(req);
  const ua = getUserAgent(req);

  try {
    const incoming = await getMfaSetupCookie();
    const challenge = await getEnrollmentChallenge(incoming, { ip, userAgent: ua });
    const refreshed = await setMfaSetupCookie(challenge.cookieValue);
    const res = NextResponse.json({
      otpauth_url: challenge.otpauthUrl,
      manual_key: challenge.manualKey,
    });
    res.cookies.set(refreshed.name, refreshed.value, refreshed.options as never);
    // Defense in depth: never cache enrollment material.
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (e) {
    if (e instanceof DomainError) {
      if (e.code === 'UNAUTHORIZED' || e.code === 'INVALID_MFA') {
        // Stale/forged setup state must not linger client-side. NOTE:
        // errorResponse() returns a plain Response without a cookie jar,
        // so build a NextResponse here to attach the clearing cookie.
        const err = toDomainError(e, correlationId);
        const res = NextResponse.json(err.toJSON(correlationId), { status: err.httpStatus });
        res.cookies.delete(getMfaSetupCookieName());
        return res;
      }
      return errorResponse(e, correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
