// src/lib/auth/jwt.ts
// JWT issue/verify per §6 rule 1: 15min access JWT in HttpOnly+Secure+SameSite=Strict cookie.

import { SignJWT, jwtVerify, errors } from 'jose';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ISSUER = 'erp-pos';
const AUDIENCE = 'erp-pos-clients';

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set in production');
    }
    return new TextEncoder().encode('sandbox-dev-secret-override-in-prod');
  }
  return new TextEncoder().encode(secret);
}

export interface AccessClaims {
  sub: string;        // user id
  company_id: string;
  scope: string;      // access_scope
  is_global: boolean;
  branch_ids: string[];
  session_id: string;
  family_id: string;
  mfa_verified: boolean;
}

export async function issueAccessToken(claims: AccessClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sub)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(getSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims & { exp: number; iat: number }> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
    requiredClaims: ['exp', 'iat', 'sub', 'company_id', 'family_id'],
  });
  return payload as unknown as AccessClaims & { exp: number; iat: number };
}

/** Revocation only. An expired access token may identify the family to revoke,
 * never authorize a request. jose verifies signature/issuer/audience before
 * raising JWTExpired; every other verification failure remains rejected.
 */
export async function verifyLogoutIdentity(token: string): Promise<{ companyId: string; familyId: string } | null> {
  let payload: Record<string, unknown>;
  try {
    payload = { ...await verifyAccessToken(token) };
  } catch (error) {
    if (!(error instanceof errors.JWTExpired) || error.claim !== 'exp') return null;
    payload = error.payload;
  }
  if (typeof payload.company_id !== 'string' || !payload.company_id
    || typeof payload.family_id !== 'string' || !payload.family_id) return null;
  return { companyId: payload.company_id, familyId: payload.family_id };
}

export const ACCESS_TOKEN_TTL_MS = ACCESS_TOKEN_TTL_SECONDS * 1000;

// Refresh token rotation: 30-day window, hashed at rest (sha256).
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
