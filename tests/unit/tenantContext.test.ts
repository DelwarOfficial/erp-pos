// tests/unit/tenantContext.test.ts
// Regression tests for AsyncLocalStorage tenant-context propagation.
// Proves tenant isolation stays fail-closed while authenticated request work
// runs inside an explicit tenantStorage.run() scope (never enterWith).

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (n: string) => (cookieStore.has(n) ? { value: cookieStore.get(n) } : undefined),
    set: (n: string, v: string) => { cookieStore.set(n, v); },
    delete: (n: string) => { cookieStore.delete(n); },
  })),
}));

import { db } from '@/lib/db';
import { issueAccessToken } from '@/lib/auth/jwt';
import { issueRefreshToken } from '@/lib/auth/refreshToken';
import { getAccessCookieName } from '@/lib/auth/sessions';
import { withAuthenticatedTenant, requirePermission } from '@/lib/auth/middleware';
import {
  buildTenantContext,
  runInTenantContext,
  getTenantContext,
} from '@/lib/db/transaction';
import { GET as meGet } from '@/app/api/v1/me/route';

const raw = new PrismaClient();

let companyA = '';
let companyB = '';
let userA = '';
let userB = '';
let permCode = '';
let fixtureRoleId = '';

function ctxFor(companyId: string, userId: string, isGlobal = false) {
  return buildTenantContext({ companyId, userId, branchIds: [], isGlobal });
}

async function tokenFor(userId: string, companyId: string, isGlobal = false) {
  const refresh = await issueRefreshToken({ userId, companyId, sessionId: 'test-session', mfaVerified: false });
  return issueAccessToken({
    sub: userId,
    company_id: companyId,
    scope: 'single_branch',
    is_global: isGlobal,
    branch_ids: [],
    session_id: 'test-session',
    family_id: refresh.familyId,
    mfa_verified: false,
  });
}

beforeAll(async () => {
  await raw.$connect();
  await raw.currency.upsert({
    where: { code: 'BDT' },
    create: { code: 'BDT', name: 'Bangladeshi Taka', decimalPlaces: 2, isActive: true },
    update: {},
  });
  const stamp = Date.now();
  const a = await raw.company.create({
    data: {
      code: 'TEST-TCTX-A-' + stamp, legalName: 'Tenant Ctx A', displayName: 'TCA',
      baseCurrencyCode: 'BDT', status: 'active',
    },
  });
  const b = await raw.company.create({
    data: {
      code: 'TEST-TCTX-B-' + stamp, legalName: 'Tenant Ctx B', displayName: 'TCB',
      baseCurrencyCode: 'BDT', status: 'active',
    },
  });
  companyA = a.id;
  companyB = b.id;
  const ua = await raw.user.create({
    data: {
      companyId: companyA, name: 'User A', email: `tctx-a-${stamp}@test.local`,
      passwordHash: 'x', accessScope: 'single_branch',
    },
  });
  const ub = await raw.user.create({
    data: {
      companyId: companyB, name: 'User B', email: `tctx-b-${stamp}@test.local`,
      passwordHash: 'x', accessScope: 'single_branch',
    },
  });
  userA = ua.id;
  userB = ub.id;
  // Permission fixture for requirePermission self-scoping tests.
  permCode = 'test.tenant.ctx.' + stamp;
  const perm = await raw.permission.create({
    data: { code: permCode, module: 'test', description: 'tenant ctx test' },
  });
  const role = await raw.role.create({
    data: { companyId: companyA, name: 'ctx-tester', isSystemRole: false },
  });
  fixtureRoleId = role.id;
  await raw.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
  await raw.userRole.create({ data: { userId: userA, roleId: role.id } });
});

afterAll(async () => {
  cookieStore.clear();
  if (fixtureRoleId) {
    await raw.userRole.deleteMany({ where: { roleId: fixtureRoleId } }).catch(() => undefined);
    await raw.rolePermission.deleteMany({ where: { roleId: fixtureRoleId } }).catch(() => undefined);
    await raw.role.deleteMany({ where: { id: fixtureRoleId } }).catch(() => undefined);
  }
  if (permCode) {
    await raw.permission.deleteMany({ where: { code: permCode } }).catch(() => undefined);
  }
  for (const id of [userA, userB]) {
    if (id) await raw.refreshToken.deleteMany({ where: { userId: id } });
    if (id) await raw.user.deleteMany({ where: { id } }).catch(() => undefined);
  }
  for (const id of [companyA, companyB]) {
    if (id) await raw.company.deleteMany({ where: { id } }).catch(() => undefined);
  }
  await raw.$disconnect();
});

describe('tenant isolation stays fail-closed', () => {
  it('tenant-scoped access without context throws TENANT_CONTEXT_REQUIRED', async () => {
    expect(getTenantContext()).toBeUndefined();
    await expect(db.user.findFirst({ where: { id: userA } })).rejects.toThrow(
      'TENANT_CONTEXT_REQUIRED:User',
    );
  });

  it('awaits a lazy PrismaPromise inside context even for a synchronous callback', async () => {
    const found = await runInTenantContext(ctxFor(companyA, userA), () =>
      db.user.findFirst({ where: { id: userA }, select: { id: true } }),
    );
    expect(found?.id).toBe(userA);
    expect(getTenantContext()).toBeUndefined();
  });

  // NOTE: work callbacks MUST be `async` and return the query promise from
  // inside the async body. Prisma 6 executes extension hooks lazily on first
  // await — a sync arrow returning a bare PrismaPromise lets the hook fire
  // after run() exits (fail-closed throw). This is asserted, not assumed.
  it('scoped access inside runInTenantContext succeeds and stays in-tenant', async () => {
    const found = await runInTenantContext(ctxFor(companyA, userA), async () => {
      return db.user.findFirst({ where: { id: userA } });
    });
    expect(found?.id).toBe(userA);
    // Cross-tenant id is invisible inside tenant A's context.
    const foreign = await runInTenantContext(ctxFor(companyA, userA), async () => {
      return db.user.findFirst({ where: { id: userB } });
    });
    expect(foreign).toBeNull();
  });

  it('Company scope restricts to the context company', async () => {
    const rows = await runInTenantContext(ctxFor(companyA, userA), async () => {
      return db.company.findMany({});
    });
    expect(rows.map((r) => r.id)).toEqual([companyA]);
  });

  it('global context bypass is preserved where intentionally supported', async () => {
    const rows = await runInTenantContext(ctxFor(companyA, userA, true), async () => {
      return db.user.findMany({ where: { id: { in: [userA, userB] } } });
    });
    expect(rows.map((r) => r.id).sort()).toEqual([userA, userB].sort());
  });

  it('concurrent requests do not leak context across tenants', async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const [seenA, seenB] = await Promise.all([
      runInTenantContext(ctxFor(companyA, userA), async () => {
        await delay(25);
        return getTenantContext()?.companyId;
      }),
      runInTenantContext(ctxFor(companyB, userB), async () => {
        await delay(5);
        return getTenantContext()?.companyId;
      }),
    ]);
    expect(seenA).toBe(companyA);
    expect(seenB).toBe(companyB);
    // Outside both scopes, no ambient context remains.
    expect(getTenantContext()).toBeUndefined();
  });
});

describe('withAuthenticatedTenant', () => {
  it('authenticates and runs work inside the tenant context', async () => {
    cookieStore.clear();
    cookieStore.set(getAccessCookieName(), await tokenFor(userA, companyA));
    const result = await withAuthenticatedTenant(async (auth) => {
      expect(auth.userId).toBe(userA);
      expect(auth.companyId).toBe(companyA);
      expect(getTenantContext()?.companyId).toBe(companyA);
      return db.user.findFirst({ where: { id: userA } });
    });
    expect(result?.id).toBe(userA);
    expect(getTenantContext()).toBeUndefined();
  });

  it('rejects invalid tokens with 401 and establishes no context', async () => {
    cookieStore.clear();
    cookieStore.set(getAccessCookieName(), 'bogus.token.here');
    await expect(
      withAuthenticatedTenant(async () => 'should-not-run'),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(getTenantContext()).toBeUndefined();
  });

  it('rejects missing tokens with 401', async () => {
    cookieStore.clear();
    await expect(
      withAuthenticatedTenant(async () => 'should-not-run'),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('requirePermission self-scopes: grant passes, missing perm 403s, never leaks tenant', async () => {
    cookieStore.clear();
    cookieStore.set(getAccessCookieName(), await tokenFor(userA, companyA));
    // Granted permission resolves (proves the check ran scoped, not 500).
    await withAuthenticatedTenant(async (auth) => {
      await requirePermission(auth, permCode);
    });
    // Missing permission is FORBIDDEN_SCOPE, not a context failure.
    await withAuthenticatedTenant(async (auth) => {
      await expect(requirePermission(auth, 'nope.missing')).rejects.toMatchObject({
        code: 'FORBIDDEN_SCOPE',
      });
    });
  });
});

describe('GET /api/v1/me', () => {
  function meReq(): NextRequest {
    return new NextRequest('http://localhost/api/v1/me');
  }

  it('returns the profile without TENANT_CONTEXT_REQUIRED', async () => {
    cookieStore.clear();
    cookieStore.set(getAccessCookieName(), await tokenFor(userA, companyA));
    const res = await meGet(meReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(userA);
    expect(body.user.company_id).toBe(companyA);
    expect(body.user.email).toContain('tctx-a-');
  });

  it('returns 401 when unauthenticated', async () => {
    cookieStore.clear();
    const res = await meGet(meReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
