import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { applyTenantIsolation } from '@/lib/db/tenantClient';
import { tenantStorage } from '@/lib/db/transactionContext';

describe('indirect createMany parent validation SQL growth', () => {
  it('measures actual SQL on rollback-only synthetic fixtures', async () => {
    const raw = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
    const scoped = applyTenantIsolation(raw);
    let reads = 0;
    let statements = 0;
    raw.$on('query', event => {
      statements++;
      if (/^\s*SELECT\b/i.test(event.query)) reads++;
    });
    const rollback = new Error('fixture rollback');
    const companyId = randomUUID();
    try {
      await tenantStorage.run({ companyId: 'fixture', branchIds: [], isGlobal: true,
        correlationId: 'fixture', requestId: 'fixture' }, () => scoped.$transaction(async tx => {
        const otherCompanyId = randomUUID();
        await tx.company.createMany({ data: [companyId, otherCompanyId].map(id => ({
          id, code: id, legalName: 'SQL growth fixture', displayName: 'SQL growth fixture', baseCurrencyCode: 'BDT',
        })) });
        const roleIds = Array.from({ length: 501 }, () => randomUUID());
        const foreignRoleId = randomUUID();
        await tx.role.createMany({ data: [
          ...roleIds.map(id => ({ id, companyId, name: id })),
          { id: foreignRoleId, companyId: otherCompanyId, name: foreignRoleId },
        ] });
        const permissionIds = Array.from({ length: 501 }, () => randomUUID());
        await tx.permission.createMany({ data: permissionIds.map(id => ({ id, code: id, module: 'fixture', description: 'fixture' })) });
        const ctx = { companyId, branchIds: [], allBranches: true, isGlobal: false,
          correlationId: 'fixture', requestId: 'fixture', transactionClient: tx as unknown as Prisma.TransactionClient };
        await tenantStorage.run(ctx, async () => {
          for (const duplicates of [false, true]) {
            for (const size of [1, 10, 50, 501]) {
              const samples: number[] = [];
              const counts: number[] = [];
              const totals: number[] = [];
              let cold = 0;
              for (let run = 0; run < 8; run++) {
                await tx.rolePermission.deleteMany({ where: { role: { companyId } } });
                reads = 0; statements = 0;
                const start = performance.now();
                const result = await tx.rolePermission.createMany({ data: permissionIds.slice(0, size).map((permissionId, i) => ({
                  roleId: roleIds[duplicates ? 0 : i], permissionId,
                })) });
                const elapsed = performance.now() - start;
                expect(result.count).toBe(size);
                expect(reads).toBe(Math.ceil((duplicates ? 1 : size) / 500));
                if (run === 0) cold = elapsed;
                else { samples.push(elapsed); counts.push(reads); totals.push(statements); }
              }
              samples.sort((a, b) => a - b);
              console.log(JSON.stringify({ duplicates, size, coldMs: cold, warmSamples: samples.length,
                medianMs: samples[3], p95Ms: samples[6], reads: [...new Set(counts)], statements: [...new Set(totals)] }));
            }
          }
          await expect(tx.rolePermission.createMany({ data: [{ roleId: foreignRoleId, permissionId: permissionIds[0] }] }))
            .rejects.toThrow('TENANT_VIOLATION');
          await expect(tx.rolePermission.createMany({ data: [{ roleId: randomUUID(), permissionId: permissionIds[0] }] }))
            .rejects.toThrow('TENANT_VIOLATION');
          await tx.rolePermission.deleteMany({});
          await expect(tx.rolePermission.createMany({ data: [
            { roleId: roleIds[0], permissionId: permissionIds[0] },
            { roleId: foreignRoleId, permissionId: permissionIds[1] },
          ] })).rejects.toThrow('TENANT_VIOLATION');
          expect(await tx.rolePermission.count()).toBe(0);
          await expect(tx.rolePermission.createMany({ data: [{ permissionId: permissionIds[0] }] as any }))
            .rejects.toThrow('TENANT_PARENT_REQUIRED:RolePermission.roleId');
          const duplicate = { roleId: roleIds[0], permissionId: permissionIds[0] };
          expect(await tx.rolePermission.createMany({ data: [duplicate, duplicate], skipDuplicates: true })).toEqual({ count: 1 });
          reads = 0;
          expect(await tx.rolePermission.createMany({ data: [] })).toEqual({ count: 0 });
          expect(reads).toBe(0);
          const userId = randomUUID();
          await tx.user.create({ data: { id: userId, companyId, name: 'fixture', email: `${userId}@test.local`, passwordHash: 'not-a-credential' } });
          reads = 0;
          expect(await tx.userRole.createMany({ data: roleIds.slice(0, 10).map(roleId => ({ userId, roleId })) })).toEqual({ count: 10 });
          expect(reads).toBe(2);
          await expect(tx.userRole.createMany({ data: [{ userId, roleId: foreignRoleId }] })).rejects.toThrow('TENANT_VIOLATION');
          await expect(tx.userRole.createMany({ data: [{ userId: randomUUID(), roleId: roleIds[0] }] })).rejects.toThrow('TENANT_VIOLATION');
        });
        throw rollback;
      }, { timeout: 120_000 }));
    } catch (error) {
      if (error !== rollback) throw error;
      expect(await raw.company.count({ where: { id: companyId } })).toBe(0);
    } finally {
      await raw.$disconnect();
    }
  });
});
