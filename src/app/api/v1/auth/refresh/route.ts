// POST /api/v1/auth/refresh
// Rotates refresh token. Detects reuse → revokes family + critical security event.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { rotateRefreshToken } from '@/lib/auth/refreshToken';
import { setAuthCookies, getRefreshCookieName, applyCookiesToResponse } from '@/lib/auth/sessions';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId, getClientIp, getUserAgent } from '@/lib/http';

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  const ip = getClientIp(req);
  const ua = getUserAgent(req);

  try {
    const cookie = req.cookies.get(getRefreshCookieName())?.value;
    if (!cookie) {
      throw new DomainError('UNAUTHORIZED', 'Refresh token required', {}, 401);
    }

    // Look up the token to find companyId + userId first
    const sha256 = (await import('node:crypto')).createHash('sha256');
    const tokenHash = sha256.update(cookie).digest('hex');
    const record = await db.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: { include: { company: true, branchAccess: true } } },
    });
    if (!record) {
      throw new DomainError('UNAUTHORIZED', 'Refresh token not recognized', {}, 401);
    }

    const user = record.user;
    if (!user.isActive || user.deletedAt) {
      throw new DomainError('UNAUTHORIZED', 'User inactive', {}, 401);
    }
    if (user.company.status !== 'active') {
      throw new DomainError('COMPANY_SUSPENDED', 'Company is not active', {}, 403);
    }

    // Rotate — this throws on reuse
    const newToken = await rotateRefreshToken({
      presentedToken: cookie,
      companyId: record.companyId,
      userId: record.userId,
      deviceId: record.deviceId ?? undefined,
      ip,
      userAgent: ua,
    });

    // Issue a new access token
    const branchIds = user.branchAccess.map(b => b.branchId);
    const sessionId = randomUUID();
    const refreshResult = await setAuthCookies({
      userId: user.id,
      companyId: user.companyId,
      accessScope: user.accessScope,
      isGlobal: user.accessScope === 'global' && user.company.code === 'PLATFORM',
      branchIds,
      familyId: newToken.familyId,
      sessionId,
      mfaVerified: true, // refresh after MFA completes keeps verification
    });

    const refreshResponse = NextResponse.json({
      refreshed: true,
      access_token_expires_in: 900,
    });
    applyCookiesToResponse(refreshResponse, refreshResult);
    return refreshResponse;
  } catch (e) {
    if (e instanceof DomainError) return errorResponse(e, correlationId);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return errorResponse(
      new DomainError('UNAUTHORIZED', msg, {}, 401),
      correlationId,
    );
  }
}
