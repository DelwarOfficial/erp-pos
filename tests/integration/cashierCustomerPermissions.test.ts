// What a cashier may do with customers, checked against the real permission
// lookup in the disposable MariaDB (only the session is stubbed):
//   - a user with exactly the catalogue's cashier role can search customers
//     (customer.read), so New Sale's customer search works at the till;
//   - the same user cannot add a customer (customer.create): POST is refused
//     with 403 and nothing is written.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { SYSTEM_ROLES } from '@/lib/permissions/catalogue';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const auth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/auth/middleware', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth/middleware')>()),
  authenticateRequest: async () => auth.current,
}));

import { GET, POST } from '@/app/api/v1/customers/route';

const db = new PrismaClient();
const COMPANY_ID = '9c4e5f60-7182-4d9e-bf01-2b3c4d5e6f70';
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'CC', code: 'SYN-CC' });
  const spec = SYSTEM_ROLES.find(role => role.name === 'cashier')!;
  const permissions = await db.permission.findMany({ where: { code: { in: [...spec.permissions] } } });
  expect(permissions.map(p => p.code).sort()).toEqual([...spec.permissions].sort());
  const role = await db.role.create({ data: { companyId: COMPANY_ID, name: `cashier-${randomUUID().slice(0, 8)}`,
    permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
  const user = await db.user.create({ data: { companyId: COMPANY_ID, name: 'Test cashier', email: `${randomUUID()}@example.invalid`,
    passwordHash: 'not-a-login', accessScope: 'single_branch', roles: { create: { roleId: role.id } }, branchAccess: { create: { branchId: fx.branches[0].id } } } });
  const ctx = { companyId: COMPANY_ID, branchIds: [fx.branches[0].id], allBranches: false, isGlobal: false, userId: user.id, correlationId: randomUUID(), requestId: randomUUID() };
  auth.current = { userId: user.id, companyId: COMPANY_ID, branchIds: [fx.branches[0].id], accessScope: 'single_branch', isGlobal: false, ctx };
  await db.customer.create({ data: { companyId: COMPANY_ID, name: 'Rahima Begum', phone: '01755000111' } });
}, 120_000);
afterAll(() => db.$disconnect());

describe('cashier and customers', () => {
  it('the cashier role has customer.read and not customer.create', () => {
    const cashier = SYSTEM_ROLES.find(role => role.name === 'cashier')!.permissions;
    expect(cashier).toContain('customer.read');
    expect(cashier).not.toContain('customer.create');
  });

  it('a cashier can search customers by mobile', async () => {
    const res = await GET(new NextRequest('http://local.test/api/v1/customers?search=01755000111'));
    expect(res.status).toBe(200);
    expect((await res.json()).items.map((c: { name: string }) => c.name)).toContain('Rahima Begum');
  });

  it('a cashier cannot add a customer, and nothing is written', async () => {
    const before = await db.customer.count({ where: { companyId: COMPANY_ID } });
    const res = await POST(new NextRequest('http://local.test/api/v1/customers', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `t-${randomUUID()}` },
      body: JSON.stringify({ name: 'Should not exist' }),
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toMatch(/customer\.create/);
    expect(await db.customer.count({ where: { companyId: COMPANY_ID } })).toBe(before);
  });
});
