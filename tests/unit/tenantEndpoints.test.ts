// tests/unit/tenantEndpoints.test.ts
// Endpoint-level proof that authenticated routes run tenant-scoped work
// inside explicit context (no ambient AsyncLocalStorage from login).
// Covers: catalogue, inventory, sales, administration, WebAuthn begin,
// cross-tenant invisibility, and unchanged 401 behavior.

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

import { issueAccessToken } from '@/lib/auth/jwt';
import { getAccessCookieName } from '@/lib/auth/sessions';
import { GET as brandsGet } from '@/app/api/v1/brands/route';
import { GET as stocksGet } from '@/app/api/v1/inventory/stocks/route';
import { GET as salesGet } from '@/app/api/v1/sales/route';
import { GET as approvalsGet } from '@/app/api/v1/approvals/route';
import { POST as webauthnBegin } from '@/app/api/v1/webauthn/registration/begin/route';

const raw = new PrismaClient();

let companyA = '';
let companyB = '';
let userA = '';

function authedReq(path: string, token?: string): NextRequest {
  if (token) cookieStore.set(getAccessCookieName(), token);
  else cookieStore.delete(getAccessCookieName());
  return new NextRequest(`http://localhost${path}`);
}

async function tokenFor(userId: string, companyId: string): Promise<string> {
  return issueAccessToken({
    sub: userId,
    company_id: companyId,
    scope: 'single_branch',
    is_global: false,
    branch_ids: [],
    session_id: 'test-session',
    family_id: 'test-family',
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
      code: 'TEST-EP-A-' + stamp, legalName: 'Endpoint A', displayName: 'EPA',
      baseCurrencyCode: 'BDT', status: 'active',
    },
  });
  const b = await raw.company.create({
    data: {
      code: 'TEST-EP-B-' + stamp, legalName: 'Endpoint B', displayName: 'EPB',
      baseCurrencyCode: 'BDT', status: 'active',
    },
  });
  companyA = a.id;
  companyB = b.id;
  const ua = await raw.user.create({
    data: {
      companyId: companyA, name: 'Endpoint User', email: `tep-${stamp}@test.local`,
      passwordHash: 'x', accessScope: 'single_branch',
    },
  });
  userA = ua.id;

  // Permissions needed by the exercised endpoints.
  const codes = ['category.manage', 'product.read', 'inventory.read', 'sale.read', 'audit_logs:read'];
  const permIds: string[] = [];
  for (const code of codes) {
    const p = await raw.permission.upsert({
      where: { code },
      create: { code, module: 'test', description: 'endpoint test' },
      update: {},
    });
    permIds.push(p.id);
  }
  const role = await raw.role.create({
    data: { companyId: companyA, name: 'endpoint-tester', isSystemRole: false },
  });
  for (const pid of permIds) {
    await raw.rolePermission.create({ data: { roleId: role.id, permissionId: pid } });
  }
  await raw.userRole.create({ data: { userId: userA, roleId: role.id } });

  // A brand in the OTHER tenant: must stay invisible to tenant A.
  await raw.brand.create({
    data: { companyId: companyB, name: 'Foreign Brand', isActive: true },
  });
});

afterAll(async () => {
  cookieStore.clear();
  if (userA) await raw.user.deleteMany({ where: { id: userA } }).catch(() => undefined);
  if (companyA) {
    await raw.userRole.deleteMany({ where: { userId: userA } }).catch(() => undefined);
    await raw.role.deleteMany({ where: { companyId: companyA } }).catch(() => undefined);
    await raw.brand.deleteMany({ where: { companyId: companyA } }).catch(() => undefined);
    await raw.company.deleteMany({ where: { id: companyA } }).catch(() => undefined);
  }
  if (companyB) {
    await raw.brand.deleteMany({ where: { companyId: companyB } }).catch(() => undefined);
    await raw.company.deleteMany({ where: { id: companyB } }).catch(() => undefined);
  }
  await raw.$disconnect();
});

describe('representative endpoints under tenant context', () => {
  it('catalogue (brands GET) returns 200, never TENANT_CONTEXT_REQUIRED', async () => {
    const res = await brandsGet(authedReq('/api/v1/brands', await tokenFor(userA, companyA)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('inventory (stocks GET) returns 200', async () => {
    const res = await stocksGet(authedReq('/api/v1/inventory/stocks', await tokenFor(userA, companyA)));
    expect(res.status).toBe(200);
  });

  it('sales (sales GET) returns 200', async () => {
    const res = await salesGet(authedReq('/api/v1/sales', await tokenFor(userA, companyA)));
    expect(res.status).toBe(200);
  });

  it('administration (approvals GET) returns 200', async () => {
    const res = await approvalsGet(authedReq('/api/v1/approvals', await tokenFor(userA, companyA)));
    expect(res.status).toBe(200);
  });

  it("WebAuthn registration begin does not throw TENANT_CONTEXT_REQUIRED", async () => {
    const res = await webauthnBegin(
      authedReq('/api/v1/webauthn/registration/begin', await tokenFor(userA, companyA)),
    );
    const body = await res.json().catch(() => ({}));
    expect(JSON.stringify(body)).not.toContain('TENANT_CONTEXT_REQUIRED');
    expect(res.status).not.toBe(500);
  });

  it('cross-tenant records stay invisible', async () => {
    const res = await brandsGet(authedReq('/api/v1/brands', await tokenFor(userA, companyA)));
    const body = await res.json();
    const names = (body.items as Array<{ name: string }>).map((b) => b.name);
    expect(names).not.toContain('Foreign Brand');
  });

  it('unauthenticated requests still return 401', async () => {
    const res = await brandsGet(authedReq('/api/v1/brands'));
    expect(res.status).toBe(401);
  });
});
