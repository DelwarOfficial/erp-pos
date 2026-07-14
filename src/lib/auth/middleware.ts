// src/lib/auth/middleware.ts
// Authenticate incoming API requests — verify access JWT, fall back to refresh.
// Throws DomainError UNAUTHORIZED on failure.

import { cookies } from 'next/headers';
import { verifyAccessToken } from './jwt';
import { getAccessCookieName } from './sessions';
import { DomainError } from '../errors/codes';
import { db } from '../db';
import { buildTenantContext, TenantContext } from '../db/transaction';

export interface AuthResult {
  ctx: TenantContext;
  userId: string;
  companyId: string;
  accessScope: string;
  isGlobal: boolean;
  branchIds: string[];
  sessionId: string;
  familyId: string;
  mfaVerified: boolean;
}

export async function authenticateRequest(): Promise<AuthResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getAccessCookieName())?.value;
  if (!token) {
    throw new DomainError('UNAUTHORIZED', 'Authentication required', {}, 401);
  }

  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    throw new DomainError('UNAUTHORIZED', 'Invalid or expired token', {}, 401);
  }

  // Re-validate the user still exists and is active
  const user = await db.user.findFirst({
    where: { id: claims.sub, companyId: claims.company_id, isActive: true, deletedAt: null },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      branchAccess: true,
    },
  });
  if (!user) {
    throw new DomainError('UNAUTHORIZED', 'User not found or inactive', {}, 401);
  }

  const company = await db.company.findUnique({ where: { id: claims.company_id } });
  if (!company || company.status !== 'active') {
    throw new DomainError('COMPANY_SUSPENDED', 'Company is not active', {}, 403);
  }

  const ctx = buildTenantContext({
    companyId: user.companyId,
    userId: user.id,
    branchIds: claims.branch_ids,
    isGlobal: claims.is_global,
  });

  return {
    ctx,
    userId: user.id,
    companyId: user.companyId,
    accessScope: claims.scope,
    isGlobal: claims.is_global,
    branchIds: claims.branch_ids,
    sessionId: claims.session_id,
    familyId: claims.family_id,
    mfaVerified: claims.mfa_verified,
  };
}

export async function requirePermission(
  auth: AuthResult,
  permissionCode: string,
  branchId?: string,
): Promise<void> {
  // Platform operations bypass per-tenant permissions
  if (auth.isGlobal) return;

  // Check branch access
  if (branchId && !auth.branchIds.includes(branchId) && auth.accessScope !== 'global') {
    throw new DomainError('FORBIDDEN_SCOPE', 'Branch access denied', { branch_id: branchId }, 403);
  }

  // Check permission
  const user = await db.user.findUnique({
    where: { id: auth.userId },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  if (!user) throw new DomainError('UNAUTHORIZED', 'User not found', {}, 401);

  const hasPerm = user.roles.some(ur =>
    ur.role.permissions.some(rp => rp.permission.code === permissionCode),
  );
  if (!hasPerm) {
    throw new DomainError('FORBIDDEN_SCOPE', `Missing permission: ${permissionCode}`, { permission: permissionCode }, 403);
  }
}
