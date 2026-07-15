import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';
import { evaluateRiskAlerts } from '@/lib/risk/alerting';

// POST /api/v1/admin/risk-alerts/evaluate
// Manually triggers alert evaluation. Returns the alerts that were triggered.
// In production, this is called automatically by the BullMQ reconciliation worker daily.
export async function POST(req: NextRequest) {
  let auth;
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  

  try {
    await requirePermission(auth, 'audit_logs:write');
  } catch (e) {
    if (e instanceof DomainError) {
      if (!auth.isGlobal) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    } else {
      return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
    }
  }

  const alerts = await evaluateRiskAlerts();

  return NextResponse.json({
    evaluatedAt: new Date().toISOString(),
    alertsTriggered: alerts.length,
    alerts,
  });
}
