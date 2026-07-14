// POST /api/v1/auth/logout
// Revokes the refresh token family and clears auth cookies.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { clearAuthCookies, getRefreshCookieName } from '@/lib/auth/sessions';
import { revokeFamily } from '@/lib/auth/refreshToken';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);

  try {
    const cookie = req.cookies.get(getRefreshCookieName())?.value;
    if (cookie) {
      const sha256 = (await import('node:crypto')).createHash('sha256');
      const tokenHash = sha256.update(cookie).digest('hex');
      const record = await db.refreshToken.findFirst({ where: { tokenHash } });
      if (record) {
        await revokeFamily({
          companyId: record.companyId,
          familyId: record.familyId,
          reason: 'user_logout',
        });
      }
    }
    await clearAuthCookies();
    return NextResponse.json({ logged_out: true });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
