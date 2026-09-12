import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { buildTenantContext } from '@/lib/db/transaction';
import type { AuthResult } from '@/lib/auth/middleware';
const counter = vi.hoisted(() => ({ queries: 0 }));
vi.mock('@/lib/db', async () => {
  const { PrismaClient } = await import('@prisma/client');
  const { applyTenantIsolation } = await import('@/lib/db/tenantClient');
  const monitored = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  monitored.$on('query', () => { counter.queries++; }); // Never inspect/log SQL or parameters.
  return { db: applyTenantIsolation(monitored), systemDb: monitored };
});
import { listUsers } from '@/lib/access/service';
import { systemDb } from '@/lib/db';
const raw = new PrismaClient({ log: [] });
let auth: AuthResult;
beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL || 'invalid:');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') throw new Error('Disposable local database required');
  const company = await raw.company.create({ data: { code: randomUUID(), legalName: 'Synthetic query proof', displayName: 'Synthetic query proof', baseCurrencyCode: 'BDT' } });
  const branch = await raw.branch.create({ data: { companyId: company.id, code: 'A', name: 'A' } });
  const role = await raw.role.create({ data: { companyId: company.id, name: 'Query proof role' } });
  const ids = Array.from({ length: 100 }, () => randomUUID());
  await raw.user.createMany({ data: ids.map((id, i) => ({ id, companyId: company.id, name: `Synthetic ${String(i).padStart(3, '0')}`, email: `${id}@example.invalid`, passwordHash: 'unused-synthetic' })) });
  await raw.userRole.createMany({ data: ids.map(userId => ({ userId, roleId: role.id })) });
  await raw.userBranchAccess.createMany({ data: ids.map(userId => ({ userId, branchId: branch.id })) });
  auth = { companyId: company.id, userId: ids[0], accessScope: 'global', branchIds: [branch.id], isGlobal: false,
    sessionId: '', familyId: '', mfaVerified: true, ctx: buildTenantContext({ companyId: company.id, userId: ids[0], branchIds: [branch.id], allBranches: true }) };
});
afterAll(async () => { await raw.$disconnect(); await systemDb.$disconnect(); });
it('MariaDB user-list SQL counts stay constant at 1, 10, and 100 rows', async () => {
  await listUsers(auth, new URLSearchParams({ size: '1' })); // connection warmup
  const counts: number[] = [];
  for (const size of [1, 10, 100]) {
    counter.queries = 0;
    const result = await listUsers(auth, new URLSearchParams({ size: String(size) }));
    expect(result.data).toHaveLength(size); expect(result.total).toBe(100);
    expect(result.data.every(user => user.roles.length === 1 && user.branchAccess.length === 1)).toBe(true);
    counts.push(counter.queries);
  }
  expect(counts[0]).toBeGreaterThan(0); expect(counts[0]).toBeLessThanOrEqual(12);
  expect(counts[1]).toBe(counts[0]); expect(counts[2]).toBe(counts[0]);
  console.log('User-list SQL count proof (rows 1/10/100):', counts.join('/'));
});
