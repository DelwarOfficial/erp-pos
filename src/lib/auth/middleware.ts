// src/lib/auth/middleware.ts
// Authenticate incoming API requests — verify access JWT, fall back to refresh.
// Throws DomainError UNAUTHORIZED on failure.

import { cookies } from 'next/headers';
import { verifyAccessToken } from './jwt';
import { getAccessCookieName } from './sessions';
import { DomainError } from '../errors/codes';
import { db, systemDb } from '../db';
import { buildTenantContext, runInTenantContext, TenantContext } from '../db/transaction';

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
  const user = await systemDb.user.findFirst({
    where: { id: claims.sub, companyId: claims.company_id, isActive: true, deletedAt: null },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      branchAccess: true,
    },
  });
  if (!user) {
    throw new DomainError('UNAUTHORIZED', 'User not found or inactive', {}, 401);
  }

  const company = await systemDb.company.findUnique({ where: { id: claims.company_id } });
  if (!company || company.status !== 'active') {
    throw new DomainError('COMPANY_SUSPENDED', 'Company is not active', {}, 403);
  }

  const ctx = buildTenantContext({
    companyId: user.companyId,
    userId: user.id,
    branchIds: user.branchAccess.map(access => access.branchId),
    allBranches: user.accessScope === 'global',
    isGlobal: user.accessScope === 'global' && company.code === 'PLATFORM',
  });

  // NOTE: the tenant context is returned, NOT installed globally.
  // AsyncLocalStorage.enterWith() cannot propagate a store from inside this
  // async function back to the caller's continuation — code after
  // `await authenticateRequest()` would run without context (and a stale
  // store could leak across requests). Callers MUST run tenant-scoped work
  // inside runInTenantContext(auth.ctx, ...) or withAuthenticatedTenant().

  return {
    ctx,
    userId: user.id,
    companyId: user.companyId,
    accessScope: user.accessScope,
    isGlobal: ctx.isGlobal,
    branchIds: ctx.branchIds,
    sessionId: claims.session_id,
    familyId: claims.family_id,
    mfaVerified: claims.mfa_verified,
  };
}

/**
 * Authenticate the request AND run `work` inside the authenticated tenant
 * context. This is the only safe way to combine authenticateRequest() with
 * tenant-scoped Prisma access: AsyncLocalStorage state must be established
 * with tenantStorage.run() around the work, never with enterWith() as a
 * side effect (which does not propagate to the caller's continuation and
 * can leak across requests).
 */
export async function withAuthenticatedTenant<T>(
  work: (auth: AuthResult) => Promise<T>,
): Promise<T> {
  const auth = await authenticateRequest();
  return runInTenantContext(auth.ctx, async () => work(auth));
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

  // Check permission. Self-scoped: runs inside the caller's tenant context so
  // this check works regardless of whether the route wrapped itself in
  // runInTenantContext yet. Never relies on ambient AsyncLocalStorage state.
  const user = await runInTenantContext(auth.ctx, async () => {
    // NOTE: async body is required — Prisma runs extension hooks lazily on
    // first await, so a sync arrow returning a bare promise would escape.
    return db.user.findUnique({
      where: { id: auth.userId },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
  });
  if (!user) throw new DomainError('UNAUTHORIZED', 'User not found', {}, 401);

  const hasPerm = user.roles.some(ur =>
    ur.role.permissions.some(rp => rp.permission.code === permissionCode),
  );
  if (!hasPerm) {
    throw new DomainError('FORBIDDEN_SCOPE', `Missing permission: ${permissionCode}`, { permission: permissionCode }, 403);
  }
}
