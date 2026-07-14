// GET /api/v1/me
// Returns the current authenticated user's profile + permissions.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/middleware';
import { db } from '@/lib/db';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();

    const user = await db.user.findFirst({
      where: { id: auth.userId, companyId: auth.companyId },
      include: {
        company: true,
        roles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
        branchAccess: { include: { branch: true } },
      },
    });
    if (!user) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'User not found' } }, { status: 401 });
    }

    const permissions = new Set<string>();
    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) {
        permissions.add(rp.permission.code);
      }
    }

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        company_id: user.companyId,
        company_code: user.company.code,
        company_name: user.company.displayName,
        access_scope: user.accessScope,
        is_global: auth.isGlobal,
        mfa_enabled: user.mfaEnabled,
        mfa_verified: auth.mfaVerified,
        branch_ids: auth.branchIds,
        branches: user.branchAccess.map(b => ({
          id: b.branch.id,
          name: b.branch.name,
          code: b.branch.code,
        })),
        roles: user.roles.map(ur => ({
          id: ur.role.id,
          name: ur.role.name,
          is_system: ur.role.isSystemRole,
        })),
        permissions: Array.from(permissions),
      },
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
