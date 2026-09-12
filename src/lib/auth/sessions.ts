// src/lib/auth/sessions.ts
// Session-level helpers — issue access+refresh cookie pair, clear on logout.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { issueAccessToken, AccessClaims } from './jwt';
import { issueRefreshToken, IssuedRefreshToken } from './refreshToken';
import { issueMfaChallenge, readMfaChallenge, type MfaLoginChallenge } from './mfaChallenge';

const ACCESS_COOKIE = 'erp_access';
const REFRESH_COOKIE = 'erp_refresh';
const MFA_PENDING_COOKIE = 'erp_mfa_pending';

function isProd() {
  // In production with HTTPS, cookies should be Secure.
  // But when E2E_TESTING=true or running on HTTP (staging), Secure cookies
  // are rejected by the browser. Only set Secure when:
  //   1. NODE_ENV=production AND
  //   2. E2E_TESTING is not set AND
  //   3. HTTPS is explicitly enabled (or not on localhost)
  return process.env.NODE_ENV === 'production'
    && process.env.E2E_TESTING !== 'true'
    && process.env.DISABLE_SECURE_COOKIES !== 'true';
}

function sameSiteMode(): 'strict' | 'lax' {
  // In production: strict (most secure — cookie only sent on same-site requests)
  // In E2E/staging: lax (allows top-level navigations, needed for Playwright)
  return (process.env.E2E_TESTING === 'true' || process.env.DISABLE_SECURE_COOKIES === 'true')
    ? 'lax'
    : 'strict';
}

export interface CookieAuthResult {
  accessToken: string;
  refreshToken: IssuedRefreshToken;
  accessClaims: AccessClaims;
  /** Cookie definitions to apply to a NextResponse */
  cookieDefs: Array<{ name: string; value: string; options: Record<string, unknown> }>;
}

export async function setAuthCookies(params: {
  userId: string;
  companyId: string;
  accessScope: string;
  isGlobal: boolean;
  branchIds: string[];
  familyId?: string;
  deviceId?: string;
  sessionId: string;
  mfaVerified: boolean;
  /** Token already issued atomically by refresh rotation; do not issue a sibling. */
  rotatedRefreshToken?: IssuedRefreshToken;
}): Promise<CookieAuthResult> {
  const refreshToken = params.rotatedRefreshToken ?? await issueRefreshToken({
    companyId: params.companyId, userId: params.userId,
    deviceId: params.deviceId, familyId: params.familyId,
    sessionId: params.sessionId, mfaVerified: params.mfaVerified,
  });
  const accessClaims: AccessClaims = {
    sub: params.userId,
    company_id: params.companyId,
    scope: params.accessScope,
    is_global: params.isGlobal,
    branch_ids: params.branchIds,
    session_id: params.sessionId,
    family_id: refreshToken.familyId,
    mfa_verified: params.mfaVerified,
  };
  const accessToken = await issueAccessToken(accessClaims);

  const cookieDefs = [
    {
      name: ACCESS_COOKIE,
      value: accessToken,
      options: {
        httpOnly: true,
        secure: isProd(),
        sameSite: sameSiteMode(),
        path: '/',
        maxAge: 15 * 60, // 15 minutes
      },
    },
    {
      name: REFRESH_COOKIE,
      value: refreshToken.token,
      options: {
        httpOnly: true,
        secure: isProd(),
        sameSite: sameSiteMode(),
        path: '/api/v1/auth/refresh',
        maxAge: 30 * 24 * 60 * 60, // 30 days
      },
    },
  ];

  // Also set via next/headers for Server Component compatibility
  const cookieStore = await cookies();
  for (const def of cookieDefs) {
    cookieStore.set(def.name, def.value, def.options as never);
  }

  return { accessToken, refreshToken, accessClaims, cookieDefs };
}

/**
 * Apply auth cookies to a NextResponse object (for Route Handlers).
 * Use this after creating the response: `applyCookiesToResponse(res, result)`
 */
export function applyCookiesToResponse(
  res: NextResponse,
  result: CookieAuthResult,
): NextResponse {
  for (const def of result.cookieDefs) {
    res.cookies.set(def.name, def.value, def.options as never);
  }
  return res;
}

export async function clearAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  for (const [name, path] of [
    [ACCESS_COOKIE, '/'], [REFRESH_COOKIE, '/api/v1/auth/refresh'],
    [MFA_PENDING_COOKIE, '/'], ['erp_mfa_setup', '/api/v1/auth/mfa'],
  ]) {
    cookieStore.set(name, '', { path, maxAge: 0, expires: new Date(0),
      httpOnly: true, secure: isProd(), sameSite: sameSiteMode() });
  }
}

export async function setMfaPendingCookie(payload: {
  userId: string;
  companyId: string;
  familyId: string;
  deviceId?: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  const cookieStore = await cookies();
  const challenge = await issueMfaChallenge({ userId: payload.userId, companyId: payload.companyId, familyId: payload.familyId });
  cookieStore.set(MFA_PENDING_COOKIE, challenge, {
    httpOnly: true,
    secure: isProd(),
    sameSite: sameSiteMode(),
    path: '/',
    maxAge: 5 * 60, // 5 minutes to complete MFA
  });
}

export async function getMfaPendingCookie(): Promise<MfaLoginChallenge | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(MFA_PENDING_COOKIE)?.value;
  return readMfaChallenge(raw);
}

export async function clearMfaPendingCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(MFA_PENDING_COOKIE);
}

export function getAccessCookieName() { return ACCESS_COOKIE; }
export function getRefreshCookieName() { return REFRESH_COOKIE; }

const MFA_SETUP_COOKIE = 'erp_mfa_setup';

/** Short-lived initial-MFA-enrollment state (HMAC-signed value, see mfaSetup). */
export async function setMfaSetupCookie(
  value: string,
  maxAgeSeconds = 10 * 60,
): Promise<{ name: string; value: string; options: Record<string, unknown> }> {
  const def = {
    name: MFA_SETUP_COOKIE,
    value,
    options: {
      httpOnly: true,
      secure: isProd(),
      sameSite: sameSiteMode(),
      path: '/api/v1/auth/mfa',
      maxAge: maxAgeSeconds,
    } as Record<string, unknown>,
  };
  const cookieStore = await cookies();
  cookieStore.set(def.name, def.value, def.options as never);
  return def;
}

export async function getMfaSetupCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(MFA_SETUP_COOKIE)?.value ?? null;
}

export async function clearMfaSetupCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(MFA_SETUP_COOKIE, '', { path: '/api/v1/auth/mfa', maxAge: 0,
    expires: new Date(0), httpOnly: true, secure: isProd(), sameSite: sameSiteMode() });
}

export function getMfaSetupCookieName() { return MFA_SETUP_COOKIE; }
