// src/lib/api/client.ts
// Central client-side helper for authenticated ERP API requests.
//
// Problem it solves: access cookies expire after 15 minutes while the
// server-side refresh session stays valid for 30 days. Previously every page
// used raw fetch(), so the first request after access-token expiry failed
// with a raw 401 ("Authentication required") even though the user was still
// legitimately logged in.
//
// Behavior:
//   1. Sends the request with credentials included (HttpOnly cookies; tokens
//      are never exposed to JavaScript, localStorage, or sessionStorage).
//   2. On 401 (and only 401): attempts exactly one refresh via
//      POST /api/v1/auth/refresh, then retries the original request exactly
//      once with identical method/headers/body.
//   3. Concurrent 401s share a single in-flight refresh (single-flight), so
//      parallel requests cannot trigger refresh-token reuse (which would
//      revoke the whole session family server-side).
//   4. Never retries 403 — permission/scope/MFA denials are final.
//   5. Auth endpoints (/api/v1/auth/*) are excluded: a 401 there carries
//      domain meaning (bad password, bad TOTP code) and retrying could
//      replay one-time codes or lock accounts.
//   6. Translates terminal auth failures into friendly bodies so pages never
//      render raw technical messages:
//        final 401 -> SESSION_EXPIRED ("Your session has expired...")
//        403       -> original code, friendly permission message
//        403 + mfa_required detail -> body preserved untouched (has MFA flag)
//   7. Never loops: at most one refresh + one retry per call.
//
// Server protections are unchanged: this helper only recovers sessions the
// server itself considers valid. Revoked/expired refresh sessions still fail
// and callers handle them (dashboard layout redirects to /login).

const REFRESH_PATH = '/api/v1/auth/refresh';
const AUTH_PREFIX = '/api/v1/auth/';

export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.';
export const FORBIDDEN_MESSAGE = 'You do not have permission to access this feature.';

function isAuthPath(input: string): boolean {
  try {
    const path = input.startsWith('http')
      ? new URL(input).pathname
      : input.split('?')[0];
    return path.startsWith(AUTH_PREFIX);
  } catch {
    return false;
  }
}

// Single-flight refresh shared by all concurrent apiFetch calls.
let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(REFRESH_PATH, {
          method: 'POST',
          credentials: 'include',
        });
        return res.ok;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

function friendlyBody(original: unknown, status: number): unknown {
  const data = (original ?? {}) as {
    error?: { code?: string; message?: string; details?: Record<string, unknown> };
  };
  if (status === 401) {
    return { error: { code: 'SESSION_EXPIRED', message: SESSION_EXPIRED_MESSAGE } };
  }
  if (status === 403) {
    // MFA challenge carries machine-readable details the UI needs — keep it.
    if (data?.error?.details && 'mfa_required' in data.error.details) return original;
    return {
      error: { code: data?.error?.code ?? 'FORBIDDEN_SCOPE', message: FORBIDDEN_MESSAGE },
    };
  }
  return original;
}

async function withFriendlyBody(res: Response): Promise<Response> {
  if (res.status !== 401 && res.status !== 403) return res;
  let parsed: unknown = null;
  try {
    parsed = await res.clone().json();
  } catch {
    parsed = null;
  }
  const headers = new Headers(res.headers);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(friendlyBody(parsed, res.status)), {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const withCreds: RequestInit = { credentials: 'include', ...init };
  const res = await fetch(input, withCreds);
  if (res.status !== 401 || isAuthPath(input)) {
    return withFriendlyBody(res);
  }

  // Single refresh attempt, shared across concurrent callers.
  const refreshed = await tryRefreshOnce();
  if (!refreshed) {
    return withFriendlyBody(res);
  }

  // Exactly one retry of the original request (same method/headers/body).
  // String/JSON/FormData bodies are reusable references; ReadableStream
  // bodies are not used by any caller.
  const retry = await fetch(input, withCreds);
  return withFriendlyBody(retry);
}

/** Clears client auth state and sends the user to login. Call on terminal 401. */
export function redirectToLogin(router: { replace: (url: string) => void }): void {
  router.replace('/login');
}
