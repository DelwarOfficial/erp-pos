import { NextRequest, NextResponse } from 'next/server';
import { requireIdempotencyKey } from "@/lib/idempotency";
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';

// POST /api/v1/admin/risk-assessments/[id]/outcome
// Records the actual outcome of a risk-assessed transaction.
// Used to measure false-positive (review/block → no_issue) and
// false-negative (allow → fraud/chargeback) rates.
//
// Body: { outcomeType, outcomeNotes?, outcomeAmount? }
// outcomeType: completed | returned | charged_back | refunded | fraud_confirmed | no_issue
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { outcomeType, outcomeNotes, outcomeAmount } = body;

  const validOutcomes = ['completed', 'returned', 'charged_back', 'refunded', 'fraud_confirmed', 'no_issue'];
  if (!validOutcomes.includes(outcomeType)) {
    return NextResponse.json({
      error: { code: 'INVALID_OUTCOME', message: `outcomeType must be one of: ${validOutcomes.join(', ')}` },
    }, { status: 400 });
  }

  // Verify the assessment exists and belongs to the same tenant
  const assessment = await db.riskAssessment.findFirst({
    where: { id, companyId: auth.companyId },
  });
  if (!assessment) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Risk assessment not found' } }, { status: 404 });
  }

  const outcome = await db.riskAssessmentOutcome.create({
    data: {
      companyId: auth.companyId,
      riskAssessmentId: id,
      outcomeType,
      outcomeNotes: outcomeNotes ?? null,
      outcomeAmount: outcomeAmount ?? null,
      recordedBy: auth.userId ?? 'unknown',
    },
  });

  return NextResponse.json({ outcome }, { status: 201 });
}
