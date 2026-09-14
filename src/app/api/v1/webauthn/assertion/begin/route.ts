// POST /api/v1/webauthn/assertion/begin
// Generate an authentication challenge for the current user (after password verified).

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { beginAuthentication } from '@/lib/auth/webauthn';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { checkDistributedRateLimit } from '@/lib/auth/distributedRateLimiter';
import { DEFAULT_MFA_LIMIT } from '@/lib/auth/rateLimiter';

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    // This endpoint requires the user to be authenticated (via password +
    // MFA pending cookie) — they're adding a second factor.
    const auth = await authenticateRequest();
    const limited = await checkDistributedRateLimit('webauthn-assertion', `${auth.companyId}:${auth.userId}`, DEFAULT_MFA_LIMIT);
    if (!limited.allowed) return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Please try again later.' } }, { status: 429 });
    const result = await runInTenantContext(auth.ctx, async () => {
      return beginAuthentication({
        companyId: auth.companyId,
        userId: auth.userId,
      });
    });
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
