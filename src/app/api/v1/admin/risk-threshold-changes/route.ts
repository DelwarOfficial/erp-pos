import { NextRequest, NextResponse } from 'next/server';
import { requireIdempotencyKey } from "@/lib/idempotency";
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';
import { RISK_CONFIG } from '@/adapters/riskProvider';

// GET /api/v1/admin/risk-threshold-changes
// Lists threshold change history. Optional ?thresholdKey=CUSTOMER_DEBT_THRESHOLD
export async function GET(req: NextRequest) {
  let auth;
    const idempotencyKey = requireIdempotencyKey(req);
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  

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
  const thresholdKey = url.searchParams.get('thresholdKey');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const where: Record<string, unknown> = {};
  if (thresholdKey) where.thresholdKey = thresholdKey;

  const [changes, total] = await Promise.all([
    db.riskThresholdChange.findMany({
      where,
      orderBy: { changedAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.riskThresholdChange.count({ where }),
  ]);

  return NextResponse.json({
    changes,
    total,
    limit,
    offset,
    currentConfig: RISK_CONFIG, // include current values for comparison
  });
}

// POST /api/v1/admin/risk-threshold-changes
// Records a threshold change. Body: { thresholdKey, oldValue, newValue, reason }
// This is a manual record — the actual env var change must be done by ops separately.
// (Automated detection of env var changes is not possible since process.env is read-only.)
export async function POST(req: NextRequest) {
  let auth;
    const idempotencyKey = requireIdempotencyKey(req);
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

  const body = await req.json().catch(() => ({}));
  const { thresholdKey, oldValue, newValue, reason } = body;

  if (!thresholdKey || !newValue) {
    return NextResponse.json({
      error: { code: 'VALIDATION_FAILED', message: 'thresholdKey and newValue are required' },
    }, { status: 400 });
  }

  const change = await db.riskThresholdChange.create({
    data: {
      companyId: auth.companyId,
      thresholdKey,
      oldValue: oldValue ?? null,
      newValue: String(newValue),
      reason: reason ?? null,
      changedBy: auth.userId ?? 'unknown',
    },
  });

  return NextResponse.json({ change }, { status: 201 });
}
