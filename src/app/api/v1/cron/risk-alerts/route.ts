import { NextRequest, NextResponse } from 'next/server';
import { evaluateRiskAlerts } from '@/lib/risk/alerting';

// POST /api/v1/cron/risk-alerts
// Token-authed endpoint for external cron services (cron-job.org, etc.)
// Does NOT require admin cookie auth — uses a shared secret instead.
//
// Auth: Authorization: Bearer <CRON_API_TOKEN>
// (CRON_API_TOKEN is set in .env)
//
// This endpoint is intentionally separate from /api/v1/admin/risk-alerts/evaluate
// so that admin endpoints always require cookie auth, while cron endpoints use
// token auth (suitable for external schedulers that can't manage login sessions).

export async function POST(req: NextRequest) {
  // Verify token
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  const expectedToken = process.env.CRON_API_TOKEN;

  if (!expectedToken) {
    return NextResponse.json(
      { error: { code: 'CRON_NOT_CONFIGURED', message: 'CRON_API_TOKEN env var not set' } },
      { status: 503 },
    );
  }

  if (token !== expectedToken) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing cron token' } },
      { status: 401 },
    );
  }

  try {
    const alerts = await evaluateRiskAlerts();
    return NextResponse.json({
      evaluatedAt: new Date().toISOString(),
      alertsTriggered: alerts.length,
      alerts,
    });
  } catch (e) {
    console.error('[cron:risk-alerts] Evaluation failed:', e);
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: e instanceof Error ? e.message : 'Unknown' } },
      { status: 500 },
    );
  }
}
