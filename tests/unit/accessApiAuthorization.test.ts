import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DomainError } from '@/lib/errors/codes';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), list: vi.fn(), save: vi.fn(), read: vi.fn(), reset: vi.fn(), remove: vi.fn(), scope: vi.fn() }));
vi.mock('@/lib/auth/middleware', () => ({ authenticateRequest: mocks.auth, requirePermission: mocks.permission }));
vi.mock('@/lib/access/service', () => ({ listUsers: mocks.list, saveUser: mocks.save, readUser: mocks.read,
  listRoles: mocks.list, readRole: mocks.read, saveRole: mocks.save, deleteRole: mocks.remove, listPermissions: mocks.list }));
vi.mock('@/lib/access/reset', () => ({ issuePasswordReset: mocks.reset }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/db/transaction', () => ({ runInTenantContext: mocks.scope }));
import { GET, POST } from '@/app/api/v1/admin/users/route';
import { GET as readUser, PATCH as updateUser } from '@/app/api/v1/admin/users/[id]/route';
import { GET as roles, POST as createRole } from '@/app/api/v1/admin/roles/route';
import { GET as readRole, PATCH as updateRole, DELETE as deleteRole } from '@/app/api/v1/admin/roles/[id]/route';
import { POST as reset } from '@/app/api/v1/admin/users/[id]/password-reset/route';
import { GET as permissions } from '@/app/api/v1/admin/permissions/route';
import { GET as companies } from '@/app/api/v1/admin/companies/route';
import { GET as branches } from '@/app/api/v1/admin/branches/route';
describe('user API authorization before data access', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({}); mocks.permission.mockResolvedValue(undefined); });
  const routes = [[GET, 'GET', 'users'], [POST, 'POST', 'users'], [readUser, 'GET', 'users/id'], [updateUser, 'PATCH', 'users/id'],
    [roles, 'GET', 'roles'], [createRole, 'POST', 'roles'], [readRole, 'GET', 'roles/id'], [updateRole, 'PATCH', 'roles/id'],
    [deleteRole, 'DELETE', 'roles/id'], [reset, 'POST', 'users/id/password-reset'], [permissions, 'GET', 'permissions'],
    [companies, 'GET', 'companies'], [branches, 'GET', 'branches']] as const;
  for (const [handler, method, path] of routes) {
    for (const status of [401, 403]) it(`${method} ${path} rejects ${status} before service call`, async () => {
      (status === 401 ? mocks.auth : mocks.permission).mockRejectedValue(new DomainError(status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN_SCOPE', 'Denied', {}, status));
      const response = await handler(new NextRequest(`http://localhost/api/v1/admin/${path}`, { method }), { params: Promise.resolve({ id: 'id' }) });
      expect(response.status).toBe(status);
      for (const spy of [mocks.list, mocks.save, mocks.read, mocks.reset, mocks.remove, mocks.scope]) expect(spy).not.toHaveBeenCalled();
    });
  }
});
