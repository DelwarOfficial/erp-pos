import { NextRequest, NextResponse } from 'next/server';
import { requireIdempotencyKey } from "@/lib/idempotency";
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';

// POST /api/v1/admin/risk-threshold-changes/[id]/revert
// Records a new change that reverts the threshold back to the oldValue of the
// referenced change. Does NOT actually modify the env var (ops must do that
// separately) — just records the audit entry.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let auth;
    const idempotencyKey = requireIdempotencyKey(req);
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  if ('error' in auth) return NextResponse.json(auth, { status: auth.status });

  try {
    await requirePermission(auth, 'audit_logs:write');
  } catch (e) {
    if (e instanceof DomainError) {
      if (!auth.isGlobal) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    } else {
      return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
    }
  }

  const { id } = await params;
  const originalChange = await db.riskThresholdChange.findUnique({ where: { id } });
  if (!originalChange) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Threshold change not found' } }, { status: 404 });
  }
  if (!originalChange.oldValue) {
    return NextResponse.json({ error: { code: 'CANNOT_REVERT', message: 'Original change had no previous value' } }, { status: 400 });
  }

  // Get current value from RISK_CONFIG
  const { RISK_CONFIG } = await import('@/adapters/riskProvider');
  const currentValue = (RISK_CONFIG as Record<string, unknown>)[originalChange.thresholdKey];

  const revertChange = await db.riskThresholdChange.create({
    data: {
      companyId: auth.companyId,
      thresholdKey: originalChange.thresholdKey,
      oldValue: String(currentValue ?? ''),
      newValue: originalChange.oldValue,
      reason: `Revert of change ${originalChange.id}: ${originalChange.reason ?? 'no reason given'}`,
      changedBy: auth.userId ?? 'unknown',
    },
  });

  return NextResponse.json({ change: revertChange, message: 'Revert recorded — update .env and restart to apply' }, { status: 201 });
}
