// GET  /api/v1/webauthn/credentials  — list current user's credentials
// DELETE /api/v1/webauthn/credentials?id=<credId>  — revoke a credential

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/middleware';
import { listCredentials, revokeCredential } from '@/lib/auth/webauthn';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { recordSecurityEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const creds = await listCredentials({
      companyId: auth.companyId,
      userId: auth.userId,
    });
    return NextResponse.json({ items: creds });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}

export async function DELETE(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const credId = req.nextUrl.searchParams.get('id');
    if (!credId) {
      return errorResponse(new Error('id query parameter required'), correlationId);
    }
    await revokeCredential({
      companyId: auth.companyId,
      userId: auth.userId,
      credentialId: credId,
    });
    await recordSecurityEvent({
      eventType: 'webauthn_credential_revoked',
      severity: 'warning',
      metadata: { credential_internal_id: credId },
      companyId: auth.companyId,
      userId: auth.userId,
    });
    return NextResponse.json({ revoked: true });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
