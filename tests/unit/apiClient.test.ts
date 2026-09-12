// tests/unit/apiClient.test.ts
// Central authenticated-fetch contract: single refresh + single retry,
// no loops, 403 passthrough, auth-path exclusion, friendly terminal bodies.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, SESSION_EXPIRED_MESSAGE, FORBIDDEN_MESSAGE } from '@/lib/api/client';

const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('apiFetch', () => {
  it('passes through successful responses untouched', async () => {
    const spy = vi.fn(async () => jsonResponse({ items: [1] }, 200));
    globalThis.fetch = spy as unknown as typeof fetch;
    const res = await apiFetch('/api/v1/sales');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [1] });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('Persona E: expired access + valid refresh recovers with one retry', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url === '/api/v1/auth/refresh') return jsonResponse({ refreshed: true }, 200);
      if (calls.filter((c) => c.url.startsWith('/api/v1/sales')).length === 1) {
        return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
      }
      return jsonResponse({ items: [] }, 200);
    }) as unknown as typeof fetch;

    const res = await apiFetch('/api/v1/sales?limit=50');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
    expect(calls.filter((c) => c.url === '/api/v1/auth/refresh')).toHaveLength(1);
    expect(calls.filter((c) => c.url.startsWith('/api/v1/sales'))).toHaveLength(2);
  });

  it('Persona F: failed refresh yields friendly SESSION_EXPIRED, no loop', async () => {
    let count = 0;
    globalThis.fetch = (async (input: unknown) => {
      count++;
      const url = String(input);
      if (url === '/api/v1/auth/refresh') return jsonResponse({ error: 'no' }, 401);
      return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    }) as unknown as typeof fetch;

    const res = await apiFetch('/api/v1/sales', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('SESSION_EXPIRED');
    expect(body.error.message).toBe(SESSION_EXPIRED_MESSAGE);
    // original + refresh only: no retry, no loop
    expect(count).toBe(2);
  });

  it('Persona H: 403 never triggers refresh and gets a friendly message', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      urls.push(String(input));
      return jsonResponse({ error: { code: 'FORBIDDEN_SCOPE', message: 'Missing permission: x' } }, 403);
    }) as unknown as typeof fetch;

    const res = await apiFetch('/api/v1/sales');
    expect(res.status).toBe(403);
    expect(urls).toHaveLength(1);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN_SCOPE');
    expect(body.error.message).toBe(FORBIDDEN_MESSAGE);
  });

  it('Persona G: MFA challenge bodies pass through with mfa_required intact', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: { code: 'INVALID_MFA', message: 'MFA needed', details: { mfa_required: true } } }, 403)
    ) as unknown as typeof fetch;

    const res = await apiFetch('/api/v1/sales');
    const body = await res.json();
    expect(body.error.details.mfa_required).toBe(true);
    expect(body.error.message).toBe('MFA needed');
  });

  it('auth endpoints never trigger refresh (no TOTP replay, no lockout risk)', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      urls.push(String(input));
      return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } }, 401);
    }) as unknown as typeof fetch;

    const res = await apiFetch('/api/v1/auth/login', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(urls).toEqual(['/api/v1/auth/login']);
    const body = await res.json();
    expect(body.error.code).toBe('SESSION_EXPIRED');
  });

  it('concurrent 401s share a single refresh (no session-family kill)', async () => {
    let refreshCalls = 0;
    let salesCalls = 0;
    globalThis.fetch = ((input: unknown) => {
      const url = String(input);
      if (url === '/api/v1/auth/refresh') {
        refreshCalls++;
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(jsonResponse({ refreshed: true }, 200)), 20);
        });
      }
      salesCalls++;
      if (salesCalls <= 3) {
        return Promise.resolve(
          jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401),
        );
      }
      return Promise.resolve(jsonResponse({ ok: true }, 200));
    }) as unknown as typeof fetch;

    const results = await Promise.all([
      apiFetch('/api/v1/a'),
      apiFetch('/api/v1/b'),
      apiFetch('/api/v1/c'),
    ]);
    expect(refreshCalls).toBe(1);
    expect(results.every((r) => r.status === 200)).toBe(true);
  });

  it('preserves method, headers, and FormData across the retry', async () => {
    const seen: Array<{ method?: string; contentType?: string; isForm: boolean }> = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/auth/refresh') return jsonResponse({}, 200);
      const headers = new Headers(init?.headers);
      seen.push({
        method: init?.method,
        contentType: headers.get('content-type') ?? undefined,
        isForm: typeof FormData !== 'undefined' && init?.body instanceof FormData,
      });
      if (seen.length === 1) return jsonResponse({ error: 'expired' }, 401);
      return jsonResponse({ ok: true }, 200);
    }) as unknown as typeof fetch;

    const fd = new FormData();
    fd.append('file', new Blob(['a']), 'a.csv');
    const res = await apiFetch('/api/v1/import-jobs', { method: 'POST', body: fd });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(seen[1]);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].isForm).toBe(true);
  });

  it('sends credentials so HttpOnly cookies travel', async () => {
    let creds: RequestCredentials | undefined;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      creds = init?.credentials;
      return jsonResponse({}, 200);
    }) as unknown as typeof fetch;
    await apiFetch('/api/v1/me');
    expect(creds).toBe('include');
  });
});
