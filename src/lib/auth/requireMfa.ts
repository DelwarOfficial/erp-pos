// src/lib/auth/requireMfa.ts
// Action-time MFA re-verification per §6 rule 2.
// MFA is mandatory for: backup download, journal/adjustment approval,
// sensitive export, fiscal-period actions, supervisor/cashier-variance approval.
// Freshness comes from the session row in the database, not the JWT claim.

import type { NextRequest } from 'next/server';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { DomainError } from '@/lib/errors/codes';
import { cookies } from 'next/headers';
import { getAccessCookieName } from './cookieNames';
import { systemDb } from '@/lib/db';

/**
 * Actions that require MFA re-verification per §6 rule 2.
 */
export const MFA_REQUIRED_ACTIONS = [
  'backup_download',
  'journal_adjustment_approval',
  'sensitive_export',
  'fiscal_period_lock',
  'fiscal_period_unlock',
  'supervisor_cashier_variance_approval',
  'tax_rule_change',
  'large_refund_approval',
  'account_transfer_approval',
] as const;

export type MfaRequiredAction = (typeof MFA_REQUIRED_ACTIONS)[number];

/**
 * How long a real MFA check (TOTP or passkey) counts for sensitive actions.
 * Decided by the product owner on 2026-11-24 (red-team workstream 5).
 */
export const MFA_STEP_UP_WINDOW_MS = 60 * 60 * 1000;

/**
 * Requires a real MFA check within MFA_STEP_UP_WINDOW_MS for this session.
 *
 * Reads the session's refresh_tokens.mfa_verified_at, not the access token's
 * mfa_verified claim: refresh rotation copied that claim forward for the
 * whole 30-day session, so step-up never asked again. Throws INVALID_MFA
 * (403) with { mfa_required, step_up } so the app can ask for a code
 * (POST /api/v1/auth/mfa/step-up) and retry.
 */
export async function requireMfaForAction(
  req: NextRequest,
  action: MfaRequiredAction,
): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getAccessCookieName())?.value;
  if (!token) throw new DomainError('UNAUTHORIZED', 'Authentication required', {}, 401);

  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    throw new DomainError('UNAUTHORIZED', 'Invalid or expired token', {}, 401);
  }

  const session = await systemDb.refreshToken.findFirst({
    where: { familyId: claims.family_id, userId: claims.sub, companyId: claims.company_id, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { mfaVerifiedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const verifiedAt = session?.mfaVerifiedAt;
  if (!verifiedAt || Date.now() - verifiedAt.getTime() > MFA_STEP_UP_WINDOW_MS) {
    throw new DomainError(
      'INVALID_MFA',
      'Enter your authenticator code to continue. Sensitive actions need a code from the last hour.',
      { action, mfa_required: true, step_up: true },
      403,
    );
  }
}
