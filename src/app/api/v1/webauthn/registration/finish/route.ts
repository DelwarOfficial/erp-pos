// POST /api/v1/webauthn/registration/finish
// Verify the registration response from the browser and store the credential.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/auth/middleware';
import { finishRegistration } from '@/lib/auth/webauthn';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { recordSecurityEvent } from '@/lib/audit';

const FinishSchema = z.object({
  response: z.record(z.string(), z.unknown()),  // RegistrationResponseJSON
  name: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const body = FinishSchema.parse(await req.json());

    const result = await finishRegistration({
      userId: auth.userId,
      companyId: auth.companyId,
      response: body.response as any,
      name: body.name,
    });

    await recordSecurityEvent({
      eventType: 'webauthn_credential_registered',
      severity: 'info',
      metadata: { credential_id: result.credentialId.slice(0, 32) },
      companyId: auth.companyId,
      userId: auth.userId,
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid WebAuthn registration payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
