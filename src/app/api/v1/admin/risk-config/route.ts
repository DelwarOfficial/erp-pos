import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { RISK_CONFIG } from '@/adapters/riskProvider';
import { DomainError } from '@/lib/errors/codes';

// GET /api/v1/admin/risk-config
// Returns the current risk-scoring thresholds (env-configurable).
// Useful for ops/admin UI to display "why was this transaction flagged?"
export async function GET(req: NextRequest) {
  let auth;
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  if ('error' in auth) return NextResponse.json(auth, { status: auth.status });

  // Require global admin permission (system:config:view or platform_admin role)
  try {
    await requirePermission(auth, 'system:config:view');
  } catch (e) {
    if (e instanceof DomainError) {
      // Fall back to isGlobal check (platform admin bypasses)
      if (!auth.isGlobal) {
        return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
      }
    } else {
      return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
    }
  }

  return NextResponse.json({
    config: RISK_CONFIG,
    description: {
      VELOCITY_WINDOW_HOURS: 'Rolling window for order velocity check (hours)',
      VELOCITY_AMOUNT_THRESHOLD: 'BDT amount in window that trips HIGH_AMOUNT_VELOCITY',
      VELOCITY_COUNT_THRESHOLD: 'Order count in window that trips HIGH_ORDER_VELOCITY',
      CUSTOMER_DEBT_THRESHOLD: 'Outstanding AR that trips HIGH_OUTSTANDING_AR (BDT)',
      CUSTOMER_DEBT_ELEVATED_THRESHOLD: 'Outstanding AR that trips ELEVATED_AR (BDT)',
      RETURN_RATIO_HIGH: 'Return/sale ratio that trips HIGH_RETURN_RATIO (0-1)',
      RETURN_RATIO_ELEVATED: 'Return/sale ratio that trips ELEVATED_RETURN_RATIO (0-1)',
      FAILED_PAYMENT_THRESHOLD: 'Failed payment count that trips REPEATED_PAYMENT_FAILURE',
      DELIVERY_COD_HIGH_AMOUNT: 'COD amount that trips HIGH_COD_AMOUNT (BDT)',
      SALE_AMOUNT_VERY_HIGH: 'Sale amount that trips VERY_HIGH_AMOUNT (BDT)',
      SALE_AMOUNT_HIGH: 'Sale amount that trips HIGH_AMOUNT (BDT)',
      DECISION_BLOCK_THRESHOLD: 'Final score >= this -> block (0-100)',
      DECISION_REVIEW_THRESHOLD: 'Final score >= this -> review (0-100)',
    },
    envVarPrefix: 'RISK_',
    example: 'Set RISK_VELOCITY_COUNT_THRESHOLD=10 to trip HIGH_ORDER_VELOCITY at 10 orders instead of 20',
  });
}
