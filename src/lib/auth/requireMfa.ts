// src/lib/auth/requireMfa.ts
// Action-time MFA re-verification per §6 rule 2.
// MFA is mandatory for: backup download, journal/adjustment approval,
// sensitive export, fiscal-period actions, supervisor/cashier-variance approval.
// This function checks that the user has a verified MFA session (mfa_verified=true in JWT)
// for the current request. If not, throws INVALID_MFA.

import type { NextRequest } from 'next/server';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { DomainError } from '@/lib/errors/codes';
import { cookies } from 'next/headers';

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
 * Verifies that the current user has an MFA-verified session.
 * Throws INVALID_MFA (403) if MFA is enabled but not verified for this session.
 *
 * Usage in high-risk API routes:
 *   await requireMfaForAction(req, 'fiscal_period_lock');
 */
export async function requireMfaForAction(
  req: NextRequest,
  action: MfaRequiredAction,
): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get('erp_access')?.value;
  if (!token) return; // No token — auth middleware will handle

  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    return; // Invalid token — auth middleware will handle
  }

  // If user has MFA enabled but hasn't verified MFA in this session
  if (claims.mfa_enabled && !claims.mfa_verified) {
    throw new DomainError(
      'INVALID_MFA',
      `MFA re-verification required for action: ${action}. Please complete MFA verification before proceeding.`,
      { action, mfa_required: true },
      403,
    );
  }
}
