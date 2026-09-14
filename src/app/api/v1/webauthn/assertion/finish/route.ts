// POST /api/v1/webauthn/assertion/finish
// Verify the authentication response.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { finishAuthentication } from '@/lib/auth/webauthn';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { recordSecurityEvent } from '@/lib/audit';
import { checkDistributedRateLimit } from '@/lib/auth/distributedRateLimiter';
import { DEFAULT_MFA_LIMIT } from '@/lib/auth/rateLimiter';

const FinishSchema = z.object({
  response: z.record(z.string(), z.unknown()),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const limited = await checkDistributedRateLimit('webauthn-assertion-finish', `${auth.companyId}:${auth.userId}`, DEFAULT_MFA_LIMIT);
    if (!limited.allowed) return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Please try again later.' } }, { status: 429 });
    const body = FinishSchema.parse(await req.json());

    const result = await runInTenantContext(auth.ctx, async () => {
      const result = await finishAuthentication({
        companyId: auth.companyId,
        userId: auth.userId,
        response: body.response as any,
      });

      await recordSecurityEvent({
        eventType: 'webauthn_authentication_success',
        severity: 'info',
        metadata: { credential_id: result.credentialId.slice(0, 32) },
        companyId: auth.companyId,
        userId: auth.userId,
      });

      return result;
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid WebAuthn assertion payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
