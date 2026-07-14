// POST /api/v1/webauthn/assertion/begin
// Generate an authentication challenge for the current user (after password verified).

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/middleware';
import { beginAuthentication } from '@/lib/auth/webauthn';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    // This endpoint requires the user to be authenticated (via password +
    // MFA pending cookie) — they're adding a second factor.
    const auth = await authenticateRequest();
    const result = await beginAuthentication({
      companyId: auth.companyId,
      userId: auth.userId,
    });
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
