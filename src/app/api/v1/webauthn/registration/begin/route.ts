// POST /api/v1/webauthn/registration/begin
// Generate a registration challenge for the current user.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/middleware';
import { beginRegistration } from '@/lib/auth/webauthn';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const user = await db.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) throw new Error('User not found');

    const result = await beginRegistration({
      userId: user.id,
      companyId: auth.companyId,
      userEmail: user.email,
      userName: user.name,
    });

    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
