import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ set: vi.fn(), revoke: vi.fn(), refreshLookup: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.set }) }));
vi.mock('@/lib/db', () => ({ systemDb: { refreshToken: { findFirst: mocks.refreshLookup } } }));
vi.mock('@/lib/auth/refreshToken', () => ({ revokeFamily: mocks.revoke, issueRefreshToken: vi.fn() }));
import { issueAccessToken, verifyAccessToken, verifyLogoutIdentity } from '@/lib/auth/jwt';
import { POST } from '@/app/api/v1/auth/logout/route';
import { clearAuthCookies, clearMfaSetupCookie } from '@/lib/auth/sessions';

const claims = { sub: 'user-a', company_id: 'tenant-a', family_id: 'family-a', scope: 'single_branch',
  is_global: false, branch_ids: ['branch-a'], session_id: 'session-a', mfa_verified: true };

describe('logout and cookie-path integrity', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.revoke.mockResolvedValue(undefined); });
  afterEach(() => vi.useRealTimers());
  it('revokes using the signed access cookie when the path-scoped refresh cookie is absent', async () => {
    const token = await issueAccessToken(claims);
    const response = await POST(new NextRequest('http://localhost/api/v1/auth/logout', {
      method: 'POST', headers: { cookie: `erp_access=${token}` },
    }));
    expect(response.status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith({ companyId: 'tenant-a', familyId: 'family-a', reason: 'user_logout' });
    expect(mocks.refreshLookup).not.toHaveBeenCalled();
  });
  it('accepts expired signed identity for revocation only, never authentication', async () => {
    vi.useFakeTimers();
    const token = await issueAccessToken(claims);
    vi.advanceTimersByTime(16 * 60 * 1000);
    await expect(verifyAccessToken(token)).rejects.toThrow();
    const identity = await verifyLogoutIdentity(token);
    expect(identity).toEqual({ companyId: 'tenant-a', familyId: 'family-a' });
  });
  it('rejects a modified tenant/family even if the token is expired', async () => {
    vi.useFakeTimers();
    const token = await issueAccessToken(claims);
    const parts = token.split('.');
    const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    parts[1] = Buffer.from(JSON.stringify({ ...body, company_id: 'tenant-b' })).toString('base64url');
    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(await verifyLogoutIdentity(parts.join('.'))).toBeNull();
  });
  it('expires every cookie at its actual issued path', async () => {
    await clearAuthCookies();
    for (const [name, path] of [['erp_access', '/'], ['erp_refresh', '/api/v1/auth/refresh'],
      ['erp_mfa_pending', '/'], ['erp_mfa_setup', '/api/v1/auth/mfa']]) {
      expect(mocks.set).toHaveBeenCalledWith(name, '', expect.objectContaining({ path, maxAge: 0, httpOnly: true }));
    }
    expect(mocks.set).toHaveBeenCalledTimes(4);
  });
  it('clears completed setup at the enrollment path', async () => {
    await clearMfaSetupCookie();
    expect(mocks.set).toHaveBeenCalledWith('erp_mfa_setup', '', expect.objectContaining({ path: '/api/v1/auth/mfa', maxAge: 0 }));
  });
});
