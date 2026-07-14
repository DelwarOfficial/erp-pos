import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';

// GET /api/v1/admin/risk-assessments
// Lists recent risk assessments with optional filters.
// Query params: ?decision=review&subjectType=sale&limit=50&offset=0
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
  const decision = url.searchParams.get('decision');
  const subjectType = url.searchParams.get('subjectType');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const where: Record<string, unknown> = {};
  if (auth.companyId) where.companyId = auth.companyId;
  if (decision) where.decision = decision;
  if (subjectType) where.subjectType = subjectType;

  const [assessments, total] = await Promise.all([
    db.riskAssessment.findMany({
      where,
      orderBy: { assessedAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        outcomes: { select: { id: true, outcomeType: true, outcomeAmount: true, recordedAt: true } },
      },
    }),
    db.riskAssessment.count({ where }),
  ]);

  return NextResponse.json({
    assessments: assessments.map((a) => ({
      id: a.id,
      providerCode: a.providerCode,
      subjectType: a.subjectType,
      subjectId: a.subjectId,
      score: a.score,
      decision: a.decision,
      reasonCodes: JSON.parse(a.reasonCodes),
      providerReference: a.providerReference,
      assessedAt: a.assessedAt,
      expiresAt: a.expiresAt,
      outcomes: a.outcomes,
    })),
    total,
    limit,
    offset,
  });
}
