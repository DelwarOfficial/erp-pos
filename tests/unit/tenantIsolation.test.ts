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
    warehouse: { findFirst: parentLookup },
  } as unknown as PrismaClient;
  applyTenantIsolation(raw);
  return { operation: (input: any) => operation(input), parentLookup };
}

describe('tenant Prisma extension', () => {
  it('fails closed for an unclassified future model', async () => {
    const { operation } = harness();
    await expect(operation({ model: 'FutureBusinessModel', operation: 'findMany', args: {}, query: vi.fn() }))
      .rejects.toThrow('TENANT_MODEL_UNCLASSIFIED');
  });

  it('preserves caller AND predicates while adding mandatory tenant predicates', async () => {
    const { operation } = harness();
    const result = await tenantStorage.run(ctx, () => operation({ model: 'Product', operation: 'findMany',
      args: { where: { AND: { isActive: true } } }, query: async (args: unknown) => args }));
    expect(result.where.AND).toEqual([{ isActive: true }, { companyId: 'company-a' }]);
  });

  it('rejects a direct branch assignment outside current access', async () => {
    const { operation } = harness(); const query = vi.fn();
    await expect(tenantStorage.run({ ...ctx, branchIds: ['branch-a'] }, () => operation({
      model: 'Sale', operation: 'create', args: { data: { companyId: ctx.companyId, branchId: 'branch-b' } }, query,
    }))).rejects.toThrow('Branch access denied');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a foreign warehouse before a stock write', async () => {
    const { operation } = harness(false); const query = vi.fn();
    await expect(tenantStorage.run({ ...ctx, branchIds: ['branch-a'] }, () => operation({
      model: 'StockMovement', operation: 'create', args: { data: { companyId: ctx.companyId, warehouseId: 'foreign-warehouse' } }, query,
    }))).rejects.toThrow('outside authorized tenant/branch scope');
    expect(query).not.toHaveBeenCalled();
  });

  it('validates parents through the current transaction, not an outside connection', async () => {
    const { operation, parentLookup } = harness(false);
    const transactionLookup = vi.fn(async () => ({ id: 'local-warehouse' }));
    await tenantStorage.run({ ...ctx, branchIds: ['branch-a'], transactionClient: {
      warehouse: { findFirst: transactionLookup },
    } as any }, () => operation({ model: 'StockMovement', operation: 'create',
      args: { data: { companyId: ctx.companyId, warehouseId: 'local-warehouse' } }, query: vi.fn() }));
    expect(transactionLookup).toHaveBeenCalledTimes(1);
    expect(parentLookup).not.toHaveBeenCalled();
  });

  it('rejects nested branch-owned mutations that would bypass extension hooks', async () => {
    const { operation } = harness();
    await expect(tenantStorage.run(ctx, () => operation({ model: 'Sale', operation: 'update',
      args: { where: { id: 'sale-a' }, data: { items: { updateMany: { where: {}, data: {} } } } }, query: vi.fn() })))
      .rejects.toThrow('Nested branch-owned writes');
  });
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
