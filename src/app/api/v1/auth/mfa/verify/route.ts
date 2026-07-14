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

    const { code } = MfaSchema.parse(await req.json());

    const user = await db.user.findFirst({
      where: { id: pending.userId, companyId: pending.companyId, deletedAt: null },
      include: { company: true, branchAccess: true },
    });
    if (!user || !user.mfaEnabled || !user.mfaSecretCiphertext) {
      throw new DomainError('INVALID_MFA', 'MFA not enabled for this user', {}, 400);
    }

    const ok = verifyMfaCode(user.mfaSecretCiphertext, 1, code);
    if (!ok) {
      await recordSecurityEvent({
        eventType: 'mfa_failed',
        severity: 'warning',
        metadata: { user_id: user.id },
        companyId: user.companyId,
        userId: user.id,
        ip,
        userAgent: ua,
      });
      throw new DomainError('INVALID_MFA', 'Invalid MFA code', {}, 401);
    }

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
