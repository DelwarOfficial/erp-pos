import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';
import { evaluateRiskAlerts } from '@/lib/risk/alerting';

// GET /api/v1/admin/risk-alerts
// Lists recent risk alerts (recorded as security events with type risk_alert_*)
export async function GET(req: NextRequest) {
  let auth;
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  if ('error' in auth) return NextResponse.json(auth, { status: auth.status });

  try {
    await requirePermission(auth, 'audit_logs:read');
  } catch (e) {
    if (e instanceof DomainError) {
      if (!auth.isGlobal) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    } else {
      return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
    }
  }

  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get('days') ?? '30', 10);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Fetch security events with type starting 'risk_alert_'
  const alerts = await db.securityEvent.findMany({
    where: {
      occurredAt: { gte: since },
      eventType: { startsWith: 'risk_alert_' },
    },
    orderBy: { occurredAt: 'desc' },
    take: 100,
  }).catch(() => []);

  return NextResponse.json({
    alerts: alerts.map((a) => ({
      id: a.id,
      eventType: a.eventType,
      severity: a.severity,
      metadata: a.metadata,
      occurredAt: a.occurredAt,
    })),
    count: alerts.length,
    days,
  });
}
