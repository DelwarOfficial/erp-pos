import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DomainError } from '@/lib/errors/codes';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), tenantWork: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: {}, systemDb: {} }));
vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: vi.fn(async () => ({ userId: 'test-user', companyId: 'tenant-a', ctx: {} })),
  requirePermission: mocks.guard,
}));
vi.mock('@/lib/db/transaction', () => ({ runInTenantContext: mocks.tenantWork, withTenant: mocks.tenantWork }));
vi.mock('@/lib/idempotency', () => ({
  requireIdempotencyKey: vi.fn(() => { throw new Error('Reached request processing before authorization'); }),
  computeRequestHash: vi.fn(), withIdempotency: vi.fn(),
}));

describe('read-only user cannot execute protected mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockImplementation(async () => { throw new DomainError('FORBIDDEN_SCOPE', 'Missing permission', {}, 403); });
  });
  const cases = [
    { path: 'accounting-policies', method: 'PUT', permission: 'journal.post', load: () => import('@/app/api/v1/accounting-policies/route') },
    { path: 'products', method: 'POST', permission: 'product.create', load: () => import('@/app/api/v1/products/route') },
    { path: 'customers', method: 'POST', permission: 'customer.create', load: () => import('@/app/api/v1/customers/route') },
    { path: 'suppliers', method: 'POST', permission: 'supplier.create', load: () => import('@/app/api/v1/suppliers/route') },
  ];
  for (const item of cases) {
    it(`${item.method} ${item.path} denies before body parsing or persistence`, async () => {
      const module = await item.load();
      const handler = (module as unknown as Record<string, (request: NextRequest) => Promise<Response>>)[item.method];
      const response = await handler(new NextRequest(`http://localhost/api/v1/${item.path}`, { method: item.method }));
      expect(response.status).toBe(403);
      expect(mocks.guard).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'tenant-a' }), item.permission);
      expect(mocks.tenantWork).not.toHaveBeenCalled();
    });
  }
});
