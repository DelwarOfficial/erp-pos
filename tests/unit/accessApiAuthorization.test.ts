import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DomainError } from '@/lib/errors/codes';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), list: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/auth/middleware', () => ({ authenticateRequest: mocks.auth, requirePermission: mocks.permission }));
vi.mock('@/lib/access/service', () => ({ listUsers: mocks.list, saveUser: mocks.save }));
import { GET, POST } from '@/app/api/v1/admin/users/route';
describe('user API authorization before data access', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({}); mocks.permission.mockResolvedValue(undefined); });
  for (const [handler, method] of [[GET, 'GET'], [POST, 'POST']] as const) {
    for (const status of [401, 403]) it(`${method} rejects ${status} before service call`, async () => {
      (status === 401 ? mocks.auth : mocks.permission).mockRejectedValue(new DomainError(status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN_SCOPE', 'Denied', {}, status));
      const response = await handler(new NextRequest('http://localhost/api/v1/admin/users', { method }));
      expect(response.status).toBe(status); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    });
  }
});
