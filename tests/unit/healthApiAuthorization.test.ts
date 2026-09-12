import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '@/lib/errors/codes';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), probe: vi.fn() }));
vi.mock('@/lib/auth/middleware', () => ({ authenticateRequest: mocks.auth, requirePermission: mocks.permission }));
vi.mock('@/lib/health/runtime', () => ({ getRuntimeHealth: mocks.probe }));
import { GET as admin } from '@/app/api/v1/admin/health/route';
import { GET as publicProbe } from '@/app/api/v1/health/route';

describe('health API disclosure and authorization', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ companyId: 'synthetic' }); mocks.permission.mockResolvedValue(undefined);
    mocks.probe.mockResolvedValue({ status: 'ok', service: 'erp-pos', checks: { database: 'ok', redis: 'ok', storage: 'skipped' },
      details: {}, response_ms: 2, timestamp: '2026-09-12T00:00:00.000Z' }); });
  for (const status of [401, 403]) {
    it(`denies ${status} before any detailed probe`, async () => {
      (status === 401 ? mocks.auth : mocks.permission).mockRejectedValue(new DomainError(status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN_SCOPE', 'sensitive-diagnostic', {}, status));
      const response = await admin(); expect(response.status).toBe(status);
      expect(mocks.probe).not.toHaveBeenCalled(); expect(await response.text()).not.toContain('sensitive-diagnostic');
    });
  }
  it('requires existing administrative permission', async () => {
    expect((await admin()).status).toBe(200);
    expect(mocks.permission).toHaveBeenCalledWith({ companyId: 'synthetic' }, 'system.config.view');
  });
  it('public readiness discloses only overall status and service', async () => {
    const response = await publicProbe();
    expect(await response.json()).toEqual({ status: 'ok', service: 'erp-pos' });
  });
  it('public readiness fails when required service is unavailable', async () => {
    mocks.probe.mockResolvedValue({ status: 'unavailable', service: 'erp-pos' });
    expect((await publicProbe()).status).toBe(503);
  });
  it('never returns raw infrastructure errors', async () => {
    mocks.probe.mockRejectedValue(new Error('sensitive-diagnostic'));
    for (const handler of [admin, publicProbe]) { const response = await handler(); expect(response.status).toBe(503); expect(await response.text()).not.toContain('sensitive-diagnostic'); }
  });
});
