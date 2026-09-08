// POST /api/v1/auth/mfa/setup/activate
// Verifies the enrollment TOTP code and activates MFA. Single-use: on success
// the setup cookie is cleared and mfaEnabled becomes true; replays fail.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getMfaSetupCookie,
  clearMfaSetupCookie,
  getMfaSetupCookieName,
  applyCookiesToResponse,
} from '@/lib/auth/sessions';
import { activateEnrollment } from '@/lib/auth/enrollment';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId, getClientIp, getUserAgent } from '@/lib/http';

const ActivateSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  const ip = getClientIp(req);
  const ua = getUserAgent(req);

  try {
    const { code } = ActivateSchema.parse(await req.json());
    const incoming = await getMfaSetupCookie();
    const result = await activateEnrollment(incoming, code, { ip, userAgent: ua });

    await clearMfaSetupCookie();
    const res = NextResponse.json({
      mfa_required: false,
      mfa_setup_completed: true,
      user: result.user,
      access_token_expires_in: result.access_token_expires_in,
    });
    res.cookies.delete(getMfaSetupCookieName());
    applyCookiesToResponse(res, result.session);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(
        new DomainError('VALIDATION_FAILED', 'Invalid activation payload', { issues: e.issues }, 400),
        correlationId,
      );
    }
    if (e instanceof DomainError) return errorResponse(e, correlationId);
    return errorResponse(e, correlationId);
  }
}
