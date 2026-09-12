import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AuthResult } from '@/lib/auth/middleware';
import { db } from '@/lib/db';
import { runInTenantContext, type TransactionClient } from '@/lib/db/transaction';
import { withAccessTransaction } from './transaction';
import { hashPassword } from '@/lib/auth/password';
import { DomainError } from '@/lib/errors/codes';
import { ADMIN_GRANTS, assertBranchAssignment, assertCompanyScope, assertGrantAuthority, forbidden, platformOnly } from './policy';

const id = z.string().min(1).max(191);
const ids = z.array(id).max(100).transform(values => [...new Set(values)]);
export const userInput = z.object({
  company_id: id, name: z.string().trim().min(1).max(150), email: z.string().trim().email().max(150).transform(value => value.toLowerCase()),
  role_ids: ids, branch_ids: ids, access_scope: z.enum(['single_branch', 'multi_branch', 'global']), is_active: z.boolean(),
  password: z.string().min(12).max(200).optional(),
}).strict();
export const roleInput = z.object({ company_id: id, name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(191).optional(), permission_ids: z.array(id).max(500).transform(values => [...new Set(values)]) }).strict();
export const safeUserSelect = {
  id: true, companyId: true, name: true, email: true, accessScope: true, isActive: true,
  mfaEnabled: true, lockedUntil: true, lastLoginAt: true, createdAt: true,
  company: { select: { id: true, displayName: true, code: true } },
  roles: { select: { role: { select: { id: true, name: true, isSystemRole: true } } } },
  branchAccess: { select: { branch: { select: { id: true, companyId: true, name: true, code: true } } } },
} satisfies Prisma.UserSelect;

function userScope(auth: AuthResult, companyId: string): Prisma.UserWhereInput {
  assertCompanyScope(auth, companyId);
  return { companyId, deletedAt: null, ...(!auth.isGlobal && auth.accessScope !== 'global' ? {
    accessScope: { not: 'global' }, branchAccess: { some: { branchId: { in: auth.branchIds } }, every: { branchId: { in: auth.branchIds } } },
  } : {}) };
}
export async function accessAudit(tx: TransactionClient, auth: AuthResult, companyId: string, action: string, entityId: string, metadata: object) {
  await tx.auditLog.create({ data: { companyId: auth.companyId, userId: auth.userId,
    correlationId: auth.ctx.correlationId, action, entityType: 'access_control', entityId,
    afterValue: JSON.stringify({ target_company_id: companyId, ...metadata }),
  } });
}

export async function accessMutation<T>(auth: AuthResult, companyId: string, grants: string[], work: (tx: TransactionClient, authority: Set<string>) => Promise<T>): Promise<T> {
  assertCompanyScope(auth, companyId);
  if (!auth.mfaVerified) forbidden('Complete MFA verification before changing access');
  return withAccessTransaction(auth.ctx, async tx => {
    // Exact tenant lock. Every mutation follows this order; no table-wide lock.
    await tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`;
    const company = await tx.company.findFirst({ where: { id: companyId, status: 'active' }, select: { id: true, code: true } });
    if (!company) forbidden('Company is unavailable');
    const actor = await tx.user.findFirst({ where: { id: auth.userId, companyId: auth.companyId, isActive: true, deletedAt: null, mfaSecretCiphertext: { not: null } },
      select: { mfaEnabled: true, accessScope: true, company: { select: { code: true } },
        roles: { select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } } } } });
    const activeSession = await tx.refreshToken.count({ where: { companyId: auth.companyId, userId: auth.userId,
      familyId: auth.familyId, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (!actor?.mfaEnabled || !activeSession) forbidden('Verified active administrator session required');
    const platform = actor.accessScope === 'global' && actor.company.code === 'PLATFORM';
    if (platform !== auth.isGlobal || actor.accessScope !== auth.accessScope) forbidden('Access changed; sign in again');
    const authority = new Set(actor.roles.flatMap(item => item.role.permissions.map(value => value.permission.code)));
    if (!platform && grants.some(grant => !authority.has(grant))) forbidden('Required administration permission missing');
    const result = await work(tx, authority);
    // A role edit can lock out someone other than the actor, so check every mutation.
    const usable = await tx.user.count({ where: { companyId, isActive: true, deletedAt: null, accessScope: 'global', mfaEnabled: true, mfaSecretCiphertext: { not: null },
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
      ...(company.code === 'PLATFORM' ? {} : { AND: ADMIN_GRANTS.map(code => ({ roles: { some: { role: {
        permissions: { some: { permission: { code } } },
      } } } })) }),
    } });
    if (!usable) forbidden('Change would leave no usable administrator with full access');
    return result;
  });
}

export async function targetUser(tx: TransactionClient, auth: AuthResult, companyId: string, userId: string) {
  const user = await tx.user.findFirst({ where: { ...userScope(auth, companyId), id: userId }, select: safeUserSelect });
  if (!user) throw new DomainError('RESOURCE_NOT_FOUND', 'User not found in your access scope', {}, 404);
  return user;
}

export async function listUsers(auth: AuthResult, query: URLSearchParams) {
  const companyId = query.get('company_id') || auth.companyId;
  const input = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), size: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().max(150).default(''), status: z.enum(['all', 'active', 'inactive']).default('all'),
    sort: z.enum(['name', 'email', 'createdAt', 'lastLoginAt']).default('name'), direction: z.enum(['asc', 'desc']).default('asc'),
  }).parse(Object.fromEntries(query));
  const where: Prisma.UserWhereInput = { ...userScope(auth, companyId),
    ...(input.search ? { OR: [{ name: { contains: input.search } }, { email: { contains: input.search } }] } : {}),
    ...(input.status !== 'all' ? { isActive: input.status === 'active' } : {}),
    AND: [query.get('role_id') ? { roles: { some: { roleId: query.get('role_id')! } } } : {},
      query.get('branch_id') ? { branchAccess: { some: { branchId: query.get('branch_id')! } } } : {}],
  };
  return runInTenantContext(auth.ctx, async () => {
    const [data, total] = await Promise.all([db.user.findMany({ where, select: safeUserSelect,
      orderBy: [{ [input.sort]: input.direction }, { id: 'asc' }], take: input.size, skip: (input.page - 1) * input.size }), db.user.count({ where })]);
    return { data, total, page: input.page, size: input.size };
  });
}
export async function readUser(auth: AuthResult, companyId: string, userId: string) {
  return runInTenantContext(auth.ctx, async () => targetUser(db, auth, companyId, userId));
}

export async function saveUser(auth: AuthResult, raw: unknown, userId?: string) {
  const input = userInput.parse(raw);
  if (userId && input.password) forbidden('Use the one-time password reset flow');
  if (!userId && !input.password) throw new DomainError('VALIDATION_FAILED', 'Initial password is required', {}, 400);
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  return accessMutation(auth, input.company_id, [userId ? 'user.update' : 'user.create', 'role.assign', 'user.deactivate'], async (tx, authority) => {
    const existing = userId ? await targetUser(tx, auth, input.company_id, userId) : null;
    if (await tx.user.count({ where: { companyId: input.company_id, email: input.email, ...(existing ? { id: { not: existing.id } } : {}) } })) {
      throw new DomainError('VALIDATION_FAILED', 'Email already exists in this company', {}, 409);
    }
    assertBranchAssignment(input.branch_ids, auth.branchIds, auth.isGlobal || auth.accessScope === 'global');
    if (!auth.isGlobal && auth.accessScope !== 'global' && input.access_scope === 'global') forbidden('Cannot grant all-branch access');
    if (input.access_scope === 'single_branch' && input.branch_ids.length !== 1) forbidden('Select exactly one branch');
    if (input.access_scope === 'multi_branch' && !input.branch_ids.length) forbidden('Select at least one branch');
    const branches = await tx.branch.count({ where: { id: { in: input.branch_ids }, companyId: input.company_id, isActive: true } });
    if (branches !== input.branch_ids.length) forbidden('Invalid branch assignment');
    const roles = await tx.role.findMany({ where: { id: { in: input.role_ids }, companyId: input.company_id },
      select: { id: true, permissions: { select: { permission: { select: { code: true } } } } } });
    if (roles.length !== input.role_ids.length) forbidden('Invalid role assignment');
    const previousRoleIds = new Set(existing?.roles.map(item => item.role.id) ?? []);
    const newlyAssigned = roles.filter(role => !previousRoleIds.has(role.id));
    if (auth.isGlobal && input.company_id !== auth.companyId && newlyAssigned.some(role => role.permissions.some(item => platformOnly(item.permission.code)))) {
      forbidden('Platform permissions cannot be assigned to tenant identities');
    }
    assertGrantAuthority(newlyAssigned.flatMap(role => role.permissions.map(item => item.permission.code)), authority, auth.isGlobal);
    if (!auth.isGlobal && existing) {
      const previous = await tx.role.findMany({ where: { companyId: input.company_id, users: { some: { userId } } },
        select: { permissions: { select: { permission: { select: { code: true } } } } } });
      assertGrantAuthority(previous.flatMap(role => role.permissions.map(item => item.permission.code)).filter(code => !platformOnly(code)), authority, false);
    }
    const data = { name: input.name, email: input.email, accessScope: input.access_scope, isActive: input.is_active,
      primaryBranchId: input.branch_ids[0] ?? null };
    const saved = existing ? await tx.user.update({ where: { id: existing.id, companyId: input.company_id }, data, select: { id: true } })
      : await tx.user.create({ data: { ...data, companyId: input.company_id, passwordHash: passwordHash! }, select: { id: true } });
    await tx.userRole.deleteMany({ where: { userId: saved.id, user: { companyId: input.company_id } } });
    await tx.userBranchAccess.deleteMany({ where: { userId: saved.id, user: { companyId: input.company_id } } });
    await tx.userRole.createMany({ data: input.role_ids.map(roleId => ({ userId: saved.id, roleId })) });
    await tx.userBranchAccess.createMany({ data: input.branch_ids.map(branchId => ({ userId: saved.id, branchId })) });
    if (existing) {
      await tx.refreshToken.updateMany({ where: { userId: saved.id, companyId: input.company_id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.webAuthnChallenge.updateMany({ where: { userId: saved.id, companyId: input.company_id, consumedAt: null }, data: { consumedAt: new Date() } });
    }
    await accessAudit(tx, auth, input.company_id, existing ? 'access.user.updated' : 'access.user.created', saved.id,
      { role_ids: input.role_ids, branch_ids: input.branch_ids, active: input.is_active, access_scope: input.access_scope });
    return tx.user.findFirstOrThrow({ where: { id: saved.id, companyId: input.company_id }, select: safeUserSelect });
  });
}

const safeRoleSelect = { id: true, name: true, description: true, companyId: true, isSystemRole: true, createdAt: true,
  permissions: { select: { permission: { select: { id: true, code: true, module: true, description: true } } } },
  _count: { select: { users: true } } } satisfies Prisma.RoleSelect;
export async function listRoles(auth: AuthResult, companyId: string, query = new URLSearchParams()) {
  assertCompanyScope(auth, companyId);
  const { page, size, search } = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1),
    size: z.coerce.number().int().min(1).max(100).default(25), search: z.string().max(100).default('') }).parse(Object.fromEntries(query));
  return runInTenantContext(auth.ctx, async () => {
    const where = { companyId, ...(search ? { name: { contains: search } } : {}) };
    const [data, total] = await Promise.all([db.role.findMany({ where, take: size, skip: (page - 1) * size,
      orderBy: [{ name: 'asc' }, { id: 'asc' }], select: safeRoleSelect }), db.role.count({ where })]);
    return { data, total, page, size };
  });
}
export async function readRole(auth: AuthResult, companyId: string, roleId: string) {
  assertCompanyScope(auth, companyId);
  return runInTenantContext(auth.ctx, async () => {
    const data = await db.role.findFirst({ where: { id: roleId, companyId }, select: safeRoleSelect });
    if (!data) throw new DomainError('RESOURCE_NOT_FOUND', 'Role not found', {}, 404);
    return data;
  });
}
export async function listPermissions(auth: AuthResult) {
  return runInTenantContext(auth.ctx, async () => {
    const rows = await db.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }], select: { id: true, code: true, module: true, description: true } });
    return auth.isGlobal ? rows : rows.filter(row => !platformOnly(row.code));
  });
}
export async function saveRole(auth: AuthResult, raw: unknown, roleId?: string) {
  const input = roleInput.parse(raw);
  return accessMutation(auth, input.company_id, [roleId ? 'role.update' : 'role.create'], async (tx, authority) => {
    const existing = roleId ? await tx.role.findFirst({ where: { id: roleId, companyId: input.company_id },
      select: { id: true, isSystemRole: true, permissions: { select: { permission: { select: { code: true } } } } } }) : null;
    if (roleId && !existing) throw new DomainError('RESOURCE_NOT_FOUND', 'Role not found', {}, 404);
    if (existing?.isSystemRole) forbidden('System roles are protected');
    if (existing && !auth.isGlobal && auth.accessScope !== 'global' && await tx.user.count({
      where: { companyId: input.company_id, roles: { some: { roleId: existing.id } }, NOT: userScope(auth, input.company_id) },
    })) forbidden('Role affects users outside your branch access');
    if (existing) assertGrantAuthority(existing.permissions.map(item => item.permission.code), authority, auth.isGlobal);
    const permissions = await tx.permission.findMany({ where: { id: { in: input.permission_ids } }, select: { id: true, code: true } });
    if (permissions.length !== input.permission_ids.length) forbidden('Unknown permission');
    if (auth.isGlobal && input.company_id !== auth.companyId && permissions.some(permission => platformOnly(permission.code))) {
      forbidden('Platform permissions belong only to platform roles');
    }
    assertGrantAuthority(permissions.map(permission => permission.code), authority, auth.isGlobal);
    const saved = existing ? await tx.role.update({ where: { id: existing.id, companyId: input.company_id },
      data: { name: input.name, description: input.description ?? null }, select: { id: true } })
      : await tx.role.create({ data: { companyId: input.company_id, name: input.name, description: input.description ?? null }, select: { id: true } });
    await tx.rolePermission.deleteMany({ where: { roleId: saved.id, role: { companyId: input.company_id } } });
    await tx.rolePermission.createMany({ data: input.permission_ids.map(permissionId => ({ roleId: saved.id, permissionId })) });
    await tx.refreshToken.updateMany({ where: { companyId: input.company_id, user: { roles: { some: { roleId: saved.id } } }, revokedAt: null }, data: { revokedAt: new Date() } });
    await accessAudit(tx, auth, input.company_id, existing ? 'access.role.updated' : 'access.role.created', saved.id, { permission_ids: input.permission_ids });
    return saved;
  });
}
export async function deleteRole(auth: AuthResult, companyId: string, roleId: string) {
  return accessMutation(auth, companyId, ['role.update'], async (tx, authority) => {
    const role = await tx.role.findFirst({ where: { id: roleId, companyId }, select: { isSystemRole: true,
      permissions: { select: { permission: { select: { code: true } } } }, _count: { select: { users: true } } } });
    if (!role) throw new DomainError('RESOURCE_NOT_FOUND', 'Role not found', {}, 404);
    if (role.isSystemRole || role._count.users) forbidden('Protected or assigned roles cannot be deleted');
    assertGrantAuthority(role.permissions.map(item => item.permission.code), authority, auth.isGlobal);
    await tx.role.delete({ where: { id: roleId, companyId } });
    await accessAudit(tx, auth, companyId, 'access.role.deleted', roleId, {});
  });
}
