import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { issueMfaChallenge, readMfaChallenge, consumeMfaChallenge } from '@/lib/auth/mfaChallenge';
import { buildTenantContext, runInTenantContext } from '@/lib/db/transaction';
import { db } from '@/lib/db';

const raw = new PrismaClient();
let companyId: string;
let userId: string;
let deniedBranchId: string;
let allowedBranchId: string;

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '43318'
    || url.pathname !== '/readiness_20260912_disposable') throw new Error('Disposable local MariaDB target required');
  const versions = await raw.$queryRaw<Array<{ version: string }>>`SELECT VERSION() AS version`;
  expect(versions[0].version.startsWith('11.8.')).toBe(true);
  const company = await raw.company.create({ data: { code: `PROOF-${randomUUID()}`, legalName: 'Synthetic Proof',
    displayName: 'Synthetic Proof', baseCurrencyCode: 'BDT', status: 'active' } });
  companyId = company.id;
  const user = await raw.user.create({ data: { companyId, name: 'Synthetic User',
    email: `${randomUUID()}@example.invalid`, passwordHash: 'unused-test-fixture', accessScope: 'single_branch' } });
  userId = user.id;
  const allowed = await raw.branch.create({ data: { companyId, code: 'A', name: 'Allowed' } });
  const denied = await raw.branch.create({ data: { companyId, code: 'B', name: 'Denied' } });
  allowedBranchId = allowed.id; deniedBranchId = denied.id;
});

afterAll(async () => {
  // Keep synthetic immutable audit history in this disposable database. No
  // trigger disabling, FK disabling or destructive production-style cleanup.
  await raw.$disconnect();
});

describe('MariaDB executable live-readiness evidence', () => {
  it('stores >1KB Bangla audit snapshots without truncation', async () => {
    const snapshot = JSON.stringify({ description: 'বাংলা নিরীক্ষা '.repeat(150), count: 150 });
    const row = await raw.auditLog.create({ data: { companyId, userId, correlationId: randomUUID(),
      action: 'readiness.proof', entityType: 'synthetic', entityId: randomUUID(), beforeValue: snapshot, afterValue: snapshot } });
    const persisted = await raw.auditLog.findUnique({ where: { id: row.id }, select: { beforeValue: true, afterValue: true } });
    expect(persisted?.beforeValue === snapshot).toBe(true);
    expect(persisted?.afterValue === snapshot).toBe(true);
  });

  it('allows exactly one winner for 100 concurrent MFA challenge consumers', async () => {
    const signed = await issueMfaChallenge({ companyId, userId, familyId: randomUUID() });
    const payload = await readMfaChallenge(signed);
    expect(Boolean(payload)).toBe(true);
    const results = await Promise.allSettled(Array.from({ length: 100 }, () => consumeMfaChallenge(payload!)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(99);
    expect(await readMfaChallenge(signed)).toBeNull();
  });

  it('blocks branch reads and writes on actual MariaDB', async () => {
    const deniedWarehouse = await raw.warehouse.create({ data: { companyId, branchId: deniedBranchId, code: 'DENIED', name: 'Denied warehouse', warehouseType: 'saleable' } });
    const ctx = buildTenantContext({ companyId, userId, branchIds: [allowedBranchId] });
    const visible = await runInTenantContext(ctx, () => db.warehouse.findMany({
      where: { id: deniedWarehouse.id }, select: { id: true },
    }));
    expect(visible).toHaveLength(0);
    await expect(runInTenantContext(ctx, () => db.warehouse.create({
      data: { companyId, branchId: deniedBranchId, code: 'ATTEMPT', name: 'Forbidden', warehouseType: 'saleable' },
    }))).rejects.toThrow('Branch access denied');
  });

  it('does not expose another company through an allowed branch context', async () => {
    const other = await raw.company.create({ data: { code: `OTHER-${randomUUID()}`, legalName: 'Other Synthetic',
      displayName: 'Other Synthetic', baseCurrencyCode: 'BDT', status: 'active' } });
    const foreignBranch = await raw.branch.create({ data: { companyId: other.id, code: 'FOREIGN', name: 'Foreign' } });
    const ctx = buildTenantContext({ companyId, userId, branchIds: [allowedBranchId, foreignBranch.id] });
    const rows = await runInTenantContext(ctx, () => db.branch.findMany({
      where: { id: foreignBranch.id }, select: { id: true },
    }));
    expect(rows).toHaveLength(0);
  });
});
