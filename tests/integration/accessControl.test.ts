import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { buildTenantContext } from '@/lib/db/transaction';
import type { AuthResult } from '@/lib/auth/middleware';
import { listUsers, readUser, saveUser, saveRole, deleteRole } from '@/lib/access/service';
import { issuePasswordReset, redeemPasswordReset } from '@/lib/access/reset';
import { ADMIN_GRANTS } from '@/lib/access/policy';
import { verifyPassword } from '@/lib/auth/password';

const raw = new PrismaClient({ log: [] });
const grants = [...ADMIN_GRANTS, 'user.create', 'role.create', 'user.reset_password', 'branch.read', 'company.read', 'product.read'];
const fixturePassword = 'Synthetic-Only-Password-123!';
let permissionIds: Record<string, string>;
beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL || 'invalid:');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') throw new Error('Guarded disposable MariaDB required');
  expect((await raw.$queryRaw<Array<{ version: string }>>`SELECT VERSION() AS version`)[0].version.startsWith('11.8.')).toBe(true);
  permissionIds = {};
  for (const code of [...grants, 'platform.onboarding.execute', 'sale.post']) permissionIds[code] = (await raw.permission.upsert({ where: { code }, update: {}, create: { code, module: 'test', description: code } })).id;
});
afterAll(async () => { await raw.$disconnect(); });

async function fixture() {
  const company = await raw.company.create({ data: { code: randomUUID(), legalName: 'Synthetic Access', displayName: 'Synthetic Access', baseCurrencyCode: 'BDT' } });
  const a = await raw.branch.create({ data: { companyId: company.id, code: 'A', name: 'A' } });
  const b = await raw.branch.create({ data: { companyId: company.id, code: 'B', name: 'B' } });
  const adminRole = await raw.role.create({ data: { companyId: company.id, name: 'Access administrator', permissions: { create: grants.map(code => ({ permissionId: permissionIds[code] })) } } });
  const staffRole = await raw.role.create({ data: { companyId: company.id, name: 'Staff', permissions: { create: [{ permissionId: permissionIds['product.read'] }] } } });
  async function administrator() {
    const user = await raw.user.create({ data: { companyId: company.id, name: 'Synthetic administrator', email: `${randomUUID()}@example.invalid`, passwordHash: 'unused-synthetic',
      accessScope: 'global', mfaEnabled: true, mfaSecretCiphertext: Buffer.alloc(64), roles: { create: [{ roleId: adminRole.id }] }, branchAccess: { create: [{ branchId: a.id }, { branchId: b.id }] } } });
    const familyId = randomUUID(), sessionId = randomUUID();
    await raw.refreshToken.create({ data: { companyId: company.id, userId: user.id, familyId, sessionId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), mfaVerified: true } });
    const auth: AuthResult = { userId: user.id, companyId: company.id, accessScope: 'global', isGlobal: false, branchIds: [a.id, b.id], sessionId, familyId, mfaVerified: true,
      ctx: buildTenantContext({ companyId: company.id, userId: user.id, branchIds: [a.id, b.id], allBranches: true }) };
    return auth;
  }
  const auth = await administrator();
  const input = () => ({ company_id: company.id, name: 'Synthetic staff', email: `${randomUUID()}@example.invalid`, role_ids: [staffRole.id], branch_ids: [a.id], access_scope: 'single_branch', is_active: true, password: fixturePassword });
  return { company, a, b, adminRole, staffRole, auth, administrator, input };
}

describe('MariaDB administration security', () => {
  it('creates/edits/suspends/reactivates with safe responses, assignments and audit', async () => {
    const f = await fixture(); const input = f.input();
    const user = await saveUser(f.auth, input);
    expect(JSON.stringify(user)).not.toMatch(/passwordHash|mfaSecret|tokenHash|Ciphertext/);
    expect(user.branchAccess.map(item => item.branch.id)).toEqual([f.a.id]);
    const { password: _password, ...update } = input;
    expect((await saveUser(f.auth, { ...update, name: 'Updated staff', is_active: false }, user.id)).isActive).toBe(false);
    expect((await saveUser(f.auth, { ...update, is_active: true }, user.id)).isActive).toBe(true);
    expect(await raw.auditLog.count({ where: { companyId: f.company.id, entityId: user.id, action: { startsWith: 'access.user.' } } })).toBe(3);
  });
  it('rejects duplicate email without exposing database internals', async () => {
    const f = await fixture(), input = f.input(); await saveUser(f.auth, input);
    await expect(saveUser(f.auth, input)).rejects.toMatchObject({ httpStatus: 409 });
  });
  it('cannot read, modify, or list another tenant', async () => {
    const a = await fixture(), b = await fixture(); const user = await saveUser(b.auth, b.input());
    await expect(readUser(a.auth, b.company.id, user.id)).rejects.toMatchObject({ httpStatus: 403 });
    await expect(readUser(a.auth, a.company.id, user.id)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(saveUser(a.auth, { ...a.input(), password: undefined }, user.id)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(listUsers(a.auth, new URLSearchParams({ company_id: b.company.id }))).rejects.toMatchObject({ httpStatus: 403 });
  });
  it('cannot assign foreign roles or branches', async () => {
    const a = await fixture(), b = await fixture();
    await expect(saveUser(a.auth, { ...a.input(), branch_ids: [b.a.id] })).rejects.toMatchObject({ httpStatus: 403 });
    await expect(saveUser(a.auth, { ...a.input(), role_ids: [b.staffRole.id] })).rejects.toMatchObject({ httpStatus: 403 });
  });
  it('accepts multiple own-company branches', async () => {
    const f = await fixture(); const user = await saveUser(f.auth, { ...f.input(), access_scope: 'multi_branch', branch_ids: [f.a.id, f.b.id] });
    expect(user.branchAccess).toHaveLength(2);
  });
  it('rejects platform and unowned permission grants', async () => {
    const f = await fixture();
    for (const code of ['platform.onboarding.execute', 'sale.post']) await expect(saveRole(f.auth, { company_id: f.company.id, name: randomUUID(), permission_ids: [permissionIds[code]] })).rejects.toMatchObject({ httpStatus: 403 });
  });
  it('creates/updates/deletes unassigned custom roles and audits changes', async () => {
    const f = await fixture(); const role = await saveRole(f.auth, { company_id: f.company.id, name: 'Custom', permission_ids: [] });
    await saveRole(f.auth, { company_id: f.company.id, name: 'Custom updated', permission_ids: [permissionIds['product.read']] }, role.id);
    await deleteRole(f.auth, f.company.id, role.id);
    expect(await raw.role.count({ where: { id: role.id } })).toBe(0);
    expect(await raw.auditLog.count({ where: { entityId: role.id, companyId: f.company.id } })).toBe(3);
  });
  it('protects system and assigned roles', async () => {
    const f = await fixture(); await raw.role.update({ where: { id: f.staffRole.id }, data: { isSystemRole: true } });
    await expect(deleteRole(f.auth, f.company.id, f.staffRole.id)).rejects.toMatchObject({ httpStatus: 403 });
    await expect(saveRole(f.auth, { company_id: f.company.id, name: 'Overwrite', permission_ids: [] }, f.staffRole.id)).rejects.toMatchObject({ httpStatus: 403 });
    await expect(deleteRole(f.auth, f.company.id, f.adminRole.id)).rejects.toMatchObject({ httpStatus: 403 });
  });
  it('blocks last-admin self-suspension and removal of admin role, atomically', async () => {
    const f = await fixture(); const user = await raw.user.findUniqueOrThrow({ where: { id: f.auth.userId } });
    const input = { company_id: f.company.id, name: user.name, email: user.email, branch_ids: [f.a.id, f.b.id], access_scope: 'global', is_active: true, role_ids: [f.adminRole.id] };
    await expect(saveUser(f.auth, { ...input, is_active: false }, user.id)).rejects.toThrow('no usable administrator');
    await expect(saveUser(f.auth, { ...input, role_ids: [] }, user.id)).rejects.toThrow('no usable administrator');
    expect(await raw.refreshToken.count({ where: { familyId: f.auth.familyId, revokedAt: null } })).toBe(1);
    expect(await raw.auditLog.count({ where: { companyId: f.company.id, entityId: user.id } })).toBe(0);
  });
  it('serializes competing last-admin removals: only one succeeds', async () => {
    const f = await fixture(), second = await f.administrator();
    const disable = async (auth: AuthResult) => { const user = await raw.user.findUniqueOrThrow({ where: { id: auth.userId } });
      return saveUser(auth, { company_id: f.company.id, name: user.name, email: user.email, branch_ids: [f.a.id, f.b.id], access_scope: 'global', is_active: false, role_ids: [f.adminRole.id] }, user.id); };
    const results = await Promise.allSettled([disable(f.auth), disable(second)]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(item => item.status === 'rejected')).toMatchObject({ reason: { httpStatus: 403 } });
    expect(await raw.user.count({ where: { companyId: f.company.id, isActive: true, accessScope: 'global' } })).toBe(1);
  });
  it('requires MFA and current mutation authority', async () => {
    const f = await fixture();
    await expect(saveUser({ ...f.auth, mfaVerified: false }, f.input())).rejects.toMatchObject({ httpStatus: 403 });
    await raw.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.adminRole.id, permissionId: permissionIds['user.create'] } } });
    await expect(saveUser(f.auth, f.input())).rejects.toMatchObject({ httpStatus: 403 });
  });
  it('one-time reset stores hash only, preserves MFA and revokes sessions', async () => {
    const f = await fixture(); const user = await saveUser(f.auth, f.input());
    await raw.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await raw.refreshToken.create({ data: { companyId: f.company.id, userId: user.id, familyId: randomUUID(), tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
    const issued = await issuePasswordReset(f.auth, f.company.id, user.id);
    const payload = JSON.parse(Buffer.from(issued.token.split('.')[0], 'base64url').toString('utf8'));
    const row = await raw.webAuthnChallenge.findUniqueOrThrow({ where: { id: payload.id } });
    expect(row.challenge === payload.nonce).toBe(false); expect(row.challenge).toHaveLength(64);
    const results = await Promise.allSettled([1, 2].map(() => redeemPasswordReset({ token: issued.token, password: fixturePassword + 'new' })));
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(item => item.status === 'rejected')).toMatchObject({ reason: { httpStatus: 401 } });
    const persisted = await raw.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(persisted.mfaEnabled).toBe(true); expect(await verifyPassword(persisted.passwordHash, fixturePassword + 'new')).toBe(true);
    expect(await raw.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    const logs = await raw.auditLog.findMany({ where: { companyId: f.company.id, entityId: user.id } });
    expect(JSON.stringify(logs)).not.toContain(payload.nonce); expect(JSON.stringify(logs)).not.toContain(fixturePassword);
  });
});
