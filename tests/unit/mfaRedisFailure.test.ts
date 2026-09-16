import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  consumed: false, sessions: 0, mode: 'success', disconnect: vi.fn(), cookie: vi.fn(),
  tx: {} as Record<string, unknown>,
}));
vi.mock('@/lib/auth/rateLimitRedis', () => ({ createRateLimitRedis: () => ({
  connect: async () => {},
  disconnect: state.disconnect,
  eval: async () => [1, 300000],
  del: async () => {
    if (state.mode === 'timeout') return new Promise(() => {});
    if (state.mode !== 'success') throw new Error('redis://private-credentials/internal-driver');
    return 1;
  },
}) }));
vi.mock('@/lib/db', () => ({ systemDb: {
  webAuthnChallenge: { updateMany: async () => {
    if (state.consumed) return { count: 0 };
    state.consumed = true; return { count: 1 };
  } },
  user: { findFirst: async () => ({ id: 'user-a', companyId: 'tenant-a', isActive: true,
    mfaEnabled: true, mfaSecretCiphertext: Buffer.from('synthetic'), accessScope: 'single_branch',
    company: { status: 'active', code: 'A' }, branchAccess: [{ branchId: 'branch-a' }] }) },
  $transaction: async (fn: (tx: unknown) => unknown) => {
    const before = { sessions: state.sessions };
    try { return await fn(state.tx); }
    catch (e) { Object.assign(state, before); throw e; }
  },
} }));
vi.mock('@/lib/auth/mfa', () => ({ verifyMfaCode: () => true }));
vi.mock('@/lib/auth/sessions', () => ({
  getMfaPendingCookie: async () => ({ id: 'challenge', userId: 'user-a', companyId: 'tenant-a',
    familyId: 'family-a', nonce: 'synthetic', issuedAt: Date.now(), expiresAt: Date.now() + 300000 }),
  setAuthCookies: state.cookie,
  clearMfaPendingCookie: async () => {},
  applyCookiesToResponse: () => {},
}));
vi.mock('@/lib/auth/refreshToken', () => ({
  issueRefreshToken: async (_params: unknown, tx: unknown) => {
    expect(tx).toBe(state.tx);
    state.sessions++;
    return { token: 'synthetic', familyId: 'family-a' };
  },
}));
vi.mock('@/lib/audit', () => ({ recordSecurityEvent: async () => {} }));
import { POST } from '@/app/api/v1/auth/mfa/verify/route';

const request = () => new NextRequest('http://localhost/api/v1/auth/mfa/verify', {
  method: 'POST', body: JSON.stringify({ code: '123456' }),
});
describe('MFA Redis failure after valid challenge', () => {
  beforeEach(() => {
    state.consumed = false; state.sessions = 0; state.mode = 'success';
    state.cookie.mockReset().mockResolvedValue({});
    state.disconnect.mockClear();
    state.tx = { securityEvent: { create: async () => ({}) } };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  for (const mode of ['disconnect', 'error', 'timeout', 'success']) {
    it(`${mode}: bounded response, one session, no Redis internals, replay denied`, async () => {
      state.mode = mode;
      vi.useFakeTimers();
      const pending = POST(request());
      await vi.advanceTimersByTimeAsync(1600);
      const response = await pending;
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain('redis://');
      expect(state.consumed).toBe(true);
      expect(state.sessions).toBe(1);
      expect(state.disconnect).toHaveBeenCalledTimes(2);
      const replay = await POST(request());
      expect(replay.status).toBe(401);
      expect(state.sessions).toBe(1);
      expect(state.cookie).toHaveBeenCalledTimes(1);
    });
  }
  it('rolls back session on cookie preparation failure without re-enabling challenge', async () => {
    state.cookie.mockRejectedValue(new Error('signing unavailable'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(state.sessions).toBe(0);
    expect(state.consumed).toBe(true);
    expect((await POST(request())).status).toBe(401);
    expect(state.sessions).toBe(0);
  });
  it('concurrent verification with reset timeout issues only one session', async () => {
    state.mode = 'timeout';
    vi.useFakeTimers();
    const responses = Promise.all([POST(request()), POST(request())]);
    await vi.advanceTimersByTimeAsync(1600);
    expect((await responses).map(r => r.status).sort()).toEqual([200, 401]);
    expect(state.sessions).toBe(1);
    expect(state.cookie).toHaveBeenCalledTimes(1);
  });
  it('rolls back session on audit failure without re-enabling challenge', async () => {
    state.tx = { securityEvent: { create: async () => { throw new Error('audit unavailable'); } } };
    expect((await POST(request())).status).toBe(500);
    expect(state.sessions).toBe(0);
    expect(state.consumed).toBe(true);
    expect((await POST(request())).status).toBe(401);
  });
});
