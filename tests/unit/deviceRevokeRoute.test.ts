// PATCH /api/v1/devices/{id}: revoking a till needs device.revoke, sees only
// this company's tills, and only branches the user can reach; it needs a
// reason, and repeating it changes nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  auth: vi.fn(), permission: vi.fn(), find: vi.fn(), update: vi.fn(), audit: vi.fn(),
}));
vi.mock('@/lib/auth/middleware', () => ({ authenticateRequest: m.auth, requirePermission: m.permission }));
vi.mock('@/lib/db/transaction', () => ({
  runInTenantContext: async (_c: unknown, work: () => unknown) => work(),
  withTenant: async (_c: unknown, work: (tx: unknown) => unknown) => work({ device: { findFirst: m.find, update: m.update }, auditLog: { create: m.audit } }),
}));
vi.mock('@/lib/idempotency', () => ({
  withIdempotency: async (_p: unknown, work: () => unknown) => work(),
  computeRequestHash: () => 'h', requireIdempotencyKey: () => 'k'.repeat(16),
}));

import { PATCH } from '@/app/api/v1/devices/[id]/route';

const TILL = '11111111-1111-4111-8111-111111111111';
const call = (body: unknown = { status: 'revoked', reason: 'Laptop stolen' }) => PATCH(new NextRequest(`http://localhost/api/v1/devices/${TILL}`, {
  method: 'PATCH', headers: { 'content-type': 'application/json', 'idempotency-key': 'k'.repeat(16) }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: TILL }) });

describe('revoke a till', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.auth.mockResolvedValue({ companyId: 'co-a', userId: 'u-1', ctx: { allBranches: false, branchIds: ['br-a'] } });
    m.permission.mockResolvedValue(undefined);
    m.find.mockResolvedValue({ id: TILL, companyId: 'co-a', branchId: 'br-a', status: 'active' });
  });

  it('needs device.revoke', async () => {
    m.permission.mockRejectedValue(Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN_SCOPE', httpStatus: 403 }));
    expect((await call()).status).toBeGreaterThanOrEqual(400);
    expect(m.permission).toHaveBeenCalledWith(expect.anything(), 'device.revoke');
    expect(m.update).not.toHaveBeenCalled();
  });

  it("looks only in the user's own company: another company's till is not found", async () => {
    m.find.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(m.find).toHaveBeenCalledWith({ where: { id: TILL, companyId: 'co-a' } });
    expect(m.update).not.toHaveBeenCalled();
  });

  it("refuses a till in a branch the user can't reach", async () => {
    m.find.mockResolvedValue({ id: TILL, companyId: 'co-a', branchId: 'br-b', status: 'active' });
    expect((await call()).status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('needs a reason; revokes once and records it; a repeat changes nothing', async () => {
    expect((await call({ status: 'revoked' })).status).toBe(400);
    expect((await call()).status).toBe(200);
    expect(m.update).toHaveBeenCalledWith({ where: { id: TILL }, data: expect.objectContaining({ status: 'revoked' }) });
    expect(m.audit).toHaveBeenCalledTimes(1);
    m.find.mockResolvedValue({ id: TILL, companyId: 'co-a', branchId: 'br-a', status: 'revoked' });
    expect((await call()).status).toBe(200);
    expect(m.update).toHaveBeenCalledTimes(1);
  });
});
