import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { applyTenantIsolation } from '../../src/lib/db/tenantClient';
import { tenantStorage, type TenantContext } from '../../src/lib/db/transactionContext';

const ctx: TenantContext = {
  companyId: 'company-a',
  userId: 'user-a',
  branchIds: [],
  isGlobal: false,
  correlationId: 'correlation-a',
  requestId: 'request-a',
};

function harness(parentFound = true) {
  let operation: (input: any) => Promise<any> = async () => undefined;
  const parentLookup = vi.fn(async () => parentFound ? { id: 'parent' } : null);
  const raw = {
    $extends(extension: any) {
      operation = extension.query.$allModels.$allOperations;
      return raw;
    },
    user: { findFirst: parentLookup },
    role: { findFirst: parentLookup },
  } as unknown as PrismaClient;
  applyTenantIsolation(raw);
  return { operation: (input: any) => operation(input), parentLookup };
}

describe('tenant Prisma extension', () => {
  it('fails closed for tenant models when context is missing', async () => {
    const { operation } = harness();
    await expect(operation({ model: 'Product', operation: 'findMany', args: {}, query: vi.fn() }))
      .rejects.toThrow('TENANT_CONTEXT_REQUIRED:Product');
  });

  it('forces context company scope even when caller supplies another company', async () => {
    const { operation } = harness();
    const query = vi.fn(async (args) => args);
    const result = await tenantStorage.run(ctx, () => operation({
      model: 'Product',
      operation: 'findMany',
      args: { where: { companyId: 'company-b' } },
      query,
    }));
    expect(result.where).toEqual({ companyId: 'company-b', AND: [{ companyId: 'company-a' }] });
  });

  it('rejects cross-tenant direct creates', async () => {
    const { operation } = harness();
    await expect(tenantStorage.run(ctx, () => operation({
      model: 'Product',
      operation: 'create',
      args: { data: { companyId: 'company-b' } },
      query: vi.fn(),
    }))).rejects.toThrow('TENANT_VIOLATION');
  });

  it('allows global reference data without tenant context', async () => {
    const { operation } = harness();
    const query = vi.fn(async () => ['BDT']);
    await expect(operation({ model: 'Currency', operation: 'findMany', args: {}, query }))
      .resolves.toEqual(['BDT']);
  });

  it('validates both tenant parents for indirect join creates', async () => {
    const { operation, parentLookup } = harness();
    const query = vi.fn(async (args) => args);
    await tenantStorage.run(ctx, () => operation({
      model: 'UserRole',
      operation: 'create',
      args: { data: { userId: 'user-a', roleId: 'role-a' } },
      query,
    }));
    expect(parentLookup).toHaveBeenCalledTimes(2);
    expect(parentLookup).toHaveBeenCalledWith({ where: { id: 'user-a', companyId: 'company-a' }, select: { id: true } });
    expect(parentLookup).toHaveBeenCalledWith({ where: { id: 'role-a', companyId: 'company-a' }, select: { id: true } });
  });

  it('rejects an indirect join when any parent belongs to another tenant', async () => {
    const { operation } = harness(false);
    await expect(tenantStorage.run(ctx, () => operation({
      model: 'UserRole',
      operation: 'create',
      args: { data: { userId: 'user-b', roleId: 'role-b' } },
      query: vi.fn(),
    }))).rejects.toThrow('TENANT_VIOLATION');
  });
});
