import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';

// GET /api/v1/admin/risk-assessments/report?from=2026-01-01&to=2026-12-31
// Returns false-positive / false-negative analysis for risk threshold tuning.
//
// Definitions:
//   - False positive (FP): decision was 'review' or 'block' but outcome was 'no_issue' or 'completed'
//   - False negative (FN): decision was 'allow' but outcome was 'charged_back', 'refunded', or 'fraud_confirmed'
//   - True positive (TP): decision was 'review'/'block' and outcome was 'charged_back'/'refunded'/'fraud_confirmed'
//   - True negative (TN): decision was 'allow' and outcome was 'no_issue' or 'completed'
//
// The report also breaks down FP/FN rates per decision threshold and per reason code,
// so admins can see which rules are over- or under-triggering.
export async function GET(req: NextRequest) {
  let auth;
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
  const fromDate = url.searchParams.get('from') ? new Date(url.searchParams.get('from')!) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toDate = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : new Date();

  // Fetch all assessments with outcomes in the date range
  const assessments = await db.riskAssessment.findMany({
    where: {
      companyId: auth.companyId,
      assessedAt: { gte: fromDate, lte: toDate },
    },
    include: { outcomes: true },
  });

  // Categorize each assessment
  let truePositives = 0, trueNegatives = 0, falsePositives = 0, falseNegatives = 0;
  let pendingReview = 0; // assessments with no outcome recorded yet
  const reasonCodeStats = new Map<string, { count: number; fp: number; fn: number; tp: number; tn: number }>();
  const lossAmount = { falseNegatives: 0, truePositives: 0 };

  for (const a of assessments) {
    const decision = a.decision;
    const reasons = JSON.parse(a.reasonCodes) as string[];

    if (a.outcomes.length === 0) {
      pendingReview++;
      continue;
    }

    // Use the most recent outcome
    const latestOutcome = a.outcomes.sort((x, y) => y.recordedAt.getTime() - x.recordedAt.getTime())[0];
    const outcomeType = latestOutcome.outcomeType;

    let category: 'TP' | 'TN' | 'FP' | 'FN';
    const isNegativeOutcome = ['charged_back', 'refunded', 'fraud_confirmed'].includes(outcomeType);
    const isPositiveOutcome = ['no_issue', 'completed'].includes(outcomeType);
    const isFlagged = decision === 'review' || decision === 'block';

    if (isFlagged && isNegativeOutcome) category = 'TP';
    else if (!isFlagged && isPositiveOutcome) category = 'TN';
    else if (isFlagged && isPositiveOutcome) category = 'FP';
    else if (!isFlagged && isNegativeOutcome) category = 'FN';
    else continue; // 'returned' is ambiguous — skip

    if (category === 'TP') truePositives++;
    else if (category === 'TN') trueNegatives++;
    else if (category === 'FP') falsePositives++;
    else if (category === 'FN') falseNegatives++;

    // Track loss amounts
    const loss = parseFloat(String(latestOutcome.outcomeAmount ?? '0'));
    if (category === 'FN') lossAmount.falseNegatives += loss;
    if (category === 'TP') lossAmount.truePositives += loss;

    // Per-reason-code stats
    for (const reason of reasons) {
      if (!reasonCodeStats.has(reason)) reasonCodeStats.set(reason, { count: 0, fp: 0, fn: 0, tp: 0, tn: 0 });
      const s = reasonCodeStats.get(reason)!;
      s.count++;
      if (category === 'FP') s.fp++;
      else if (category === 'FN') s.fn++;
      else if (category === 'TP') s.tp++;
      else if (category === 'TN') s.tn++;
    }
  }

  const totalCategorized = truePositives + trueNegatives + falsePositives + falseNegatives;
  const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : null;
  const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : null;

  // Fetch threshold changes in the same date range — lets admins correlate
  // performance shifts with specific tuning actions
  const thresholdChanges = await db.riskThresholdChange.findMany({
    where: {
      changedAt: { gte: fromDate, lte: toDate },
    },
    orderBy: { changedAt: 'asc' },
    select: {
      id: true,
      thresholdKey: true,
      oldValue: true,
      newValue: true,
      reason: true,
      changedBy: true,
      changedAt: true,
    },
  }).catch(() => []); // table may not exist in some environments

  return NextResponse.json({
    period: { from: fromDate.toISOString(), to: toDate.toISOString() },
    summary: {
      totalAssessments: assessments.length,
      withOutcomes: totalCategorized,
      pendingReview,
      truePositives,
      trueNegatives,
      falsePositives,
      falseNegatives,
      precision, // TP / (TP + FP) — when we flag, how often are we right?
      recall,    // TP / (TP + FN) — of all bad outcomes, how many did we catch?
      lossAmount,
    },
    byReasonCode: Array.from(reasonCodeStats.entries())
      .map(([code, s]) => ({
        reasonCode: code,
        ...s,
        falsePositiveRate: s.count > 0 ? s.fp / s.count : null,
        falseNegativeRate: s.count > 0 ? s.fn / s.count : null,
      }))
      .sort((a, b) => b.count - a.count),
    thresholdChanges, // tuning actions taken in this period
    recommendations: generateRecommendations(falsePositives, falseNegatives, reasonCodeStats),
  });
}

function generateRecommendations(
  falsePositives: number,
  falseNegatives: number,
  reasonCodeStats: Map<string, { count: number; fp: number; fn: number; tp: number; tn: number }>,
): string[] {
  const recs: string[] = [];

  // Overall FP/FN balance
  if (falsePositives > falseNegatives * 2) {
    recs.push('High false-positive rate — consider raising RISK_DECISION_REVIEW_THRESHOLD and RISK_DECISION_BLOCK_THRESHOLD');
  }
  if (falseNegatives > falsePositives * 2) {
    recs.push('High false-negative rate — consider lowering RISK_DECISION_REVIEW_THRESHOLD and RISK_DECISION_BLOCK_THRESHOLD');
  }

  // Per-rule recommendations
  for (const [code, stats] of reasonCodeStats.entries()) {
    if (stats.count < 10) continue; // not enough data
    const fpRate = stats.fp / stats.count;
    const fnRate = stats.fn / stats.count;

    if (fpRate > 0.5) {
      recs.push(`Rule ${code}: ${Math.round(fpRate * 100)}% false-positive rate — consider raising its score increment or threshold`);
    }
    if (fnRate > 0.3 && stats.fn > 3) {
      recs.push(`Rule ${code}: ${Math.round(fnRate * 100)}% false-negative rate — consider lowering its threshold or raising its score increment`);
    }
  }

  if (recs.length === 0) {
    recs.push('No tuning recommendations — current thresholds appear well-calibrated. Continue monitoring.');
  }

  return recs;
}
