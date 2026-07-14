// src/lib/auth/sessions.ts
// Session-level helpers — issue access+refresh cookie pair, clear on logout.

import { cookies } from 'next/headers';
import { issueAccessToken, AccessClaims } from './jwt';
import { issueRefreshToken, IssuedRefreshToken } from './refreshToken';

const ACCESS_COOKIE = 'erp_access';
const REFRESH_COOKIE = 'erp_refresh';
const MFA_PENDING_COOKIE = 'erp_mfa_pending';

function isProd() {
  return process.env.NODE_ENV === 'production';
}

export interface CookieAuthResult {
  accessToken: string;
  refreshToken: IssuedRefreshToken;
  accessClaims: AccessClaims;
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
}): Promise<CookieAuthResult> {
  const accessClaims: AccessClaims = {
    sub: params.userId,
    company_id: params.companyId,
    scope: params.accessScope,
    is_global: params.isGlobal,
    branch_ids: params.branchIds,
    session_id: params.sessionId,
    family_id: params.familyId ?? '',
    mfa_verified: params.mfaVerified,
  };
  const accessToken = await issueAccessToken(accessClaims);
  const refreshToken = await issueRefreshToken({
    companyId: params.companyId,
    userId: params.userId,
    deviceId: params.deviceId,
    familyId: params.familyId,
  });

  const cookieStore = await cookies();
  cookieStore.set(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'strict',
    path: '/',
    maxAge: 15 * 60, // 15 minutes
  });
  cookieStore.set(REFRESH_COOKIE, refreshToken.token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'strict',
    path: '/api/v1/auth/refresh',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });

  return { accessToken, refreshToken, accessClaims };
}

export async function clearAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_COOKIE);
  cookieStore.delete(REFRESH_COOKIE);
  cookieStore.delete(MFA_PENDING_COOKIE);
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
  cookieStore.set(MFA_PENDING_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'strict',
    path: '/',
    maxAge: 5 * 60, // 5 minutes to complete MFA
  });
}

export async function getMfaPendingCookie(): Promise<{
  userId: string;
  companyId: string;
  familyId: string;
  deviceId?: string;
  ip?: string;
  userAgent?: string;
} | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(MFA_PENDING_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearMfaPendingCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(MFA_PENDING_COOKIE);
}

export function getAccessCookieName() { return ACCESS_COOKIE; }
export function getRefreshCookieName() { return REFRESH_COOKIE; }
