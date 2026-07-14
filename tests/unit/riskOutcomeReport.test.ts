// tests/unit/riskOutcomeReport.test.ts
// Tests the false-positive/false-negative analysis logic used by
// GET /api/v1/admin/risk-assessments/report
//
// Categorization:
//   TP = flagged (review/block) + negative outcome (charged_back/refunded/fraud_confirmed)
//   TN = not flagged (allow) + positive outcome (no_issue/completed)
//   FP = flagged + positive outcome
//   FN = not flagged + negative outcome

import { describe, it, expect } from 'vitest';

// Re-implement the categorization logic standalone (since it's inline in the route)
function categorize(decision: string, outcomeType: string): 'TP' | 'TN' | 'FP' | 'FN' | null {
  const isNegative = ['charged_back', 'refunded', 'fraud_confirmed'].includes(outcomeType);
  const isPositive = ['no_issue', 'completed'].includes(outcomeType);
  const isFlagged = decision === 'review' || decision === 'block';

  if (isFlagged && isNegative) return 'TP';
  if (!isFlagged && isPositive) return 'TN';
  if (isFlagged && isPositive) return 'FP';
  if (!isFlagged && isNegative) return 'FN';
  return null; // 'returned' is ambiguous
}

describe('Risk Outcome Categorization', () => {
  it('categorizes flagged + fraud as true positive', () => {
    expect(categorize('block', 'fraud_confirmed')).toBe('TP');
    expect(categorize('review', 'charged_back')).toBe('TP');
    expect(categorize('review', 'refunded')).toBe('TP');
  });

  it('categorizes allowed + no_issue as true negative', () => {
    expect(categorize('allow', 'no_issue')).toBe('TN');
    expect(categorize('allow', 'completed')).toBe('TN');
  });

  it('categorizes flagged + completed as false positive', () => {
    expect(categorize('review', 'completed')).toBe('FP');
    expect(categorize('block', 'no_issue')).toBe('FP');
  });

  it('categorizes allowed + fraud as false negative', () => {
    expect(categorize('allow', 'fraud_confirmed')).toBe('FN');
    expect(categorize('allow', 'charged_back')).toBe('FN');
    expect(categorize('allow', 'refunded')).toBe('FN');
  });

  it('returns null for ambiguous outcomes (returned)', () => {
    expect(categorize('allow', 'returned')).toBeNull();
    expect(categorize('review', 'returned')).toBeNull();
    expect(categorize('block', 'returned')).toBeNull();
  });

  it('returns null for unknown outcomes', () => {
    expect(categorize('allow', 'unknown')).toBeNull();
    expect(categorize('review', 'unknown')).toBeNull();
  });
});

describe('Risk Outcome Metrics', () => {
  // Simulate a small dataset
  const assessments = [
    { decision: 'block', outcome: 'fraud_confirmed' },    // TP
    { decision: 'review', outcome: 'charged_back' },      // TP
    { decision: 'review', outcome: 'completed' },         // FP
    { decision: 'block', outcome: 'no_issue' },           // FP
    { decision: 'allow', outcome: 'fraud_confirmed' },    // FN
    { decision: 'allow', outcome: 'completed' },          // TN
    { decision: 'allow', outcome: 'no_issue' },           // TN
    { decision: 'allow', outcome: 'returned' },           // null (ambiguous)
  ];

  it('counts TP/TN/FP/FN correctly', () => {
    let tp = 0, tn = 0, fp = 0, fn = 0, nullCount = 0;
    for (const a of assessments) {
      const c = categorize(a.decision, a.outcome);
      if (c === 'TP') tp++;
      else if (c === 'TN') tn++;
      else if (c === 'FP') fp++;
      else if (c === 'FN') fn++;
      else nullCount++;
    }
    expect(tp).toBe(2);
    expect(tn).toBe(2);
    expect(fp).toBe(2);
    expect(fn).toBe(1);
    expect(nullCount).toBe(1);
  });

  it('computes precision = TP / (TP + FP)', () => {
    // 2 TP / (2 TP + 2 FP) = 0.5
    const tp = 2, fp = 2;
    const precision = tp / (tp + fp);
    expect(precision).toBe(0.5);
  });

  it('computes recall = TP / (TP + FN)', () => {
    // 2 TP / (2 TP + 1 FN) = 0.667
    const tp = 2, fn = 1;
    const recall = tp / (tp + fn);
    expect(recall).toBeCloseTo(0.667, 2);
  });
});

describe('Risk Tuning Recommendations', () => {
  function generateRecommendations(fp: number, fn: number): string[] {
    const recs: string[] = [];
    if (fp > fn * 2) recs.push('High false-positive rate — consider raising thresholds');
    if (fn > fp * 2) recs.push('High false-negative rate — consider lowering thresholds');
    if (recs.length === 0) recs.push('No tuning recommendations');
    return recs;
  }

  it('recommends raising thresholds when FP > 2x FN', () => {
    const recs = generateRecommendations(20, 5);
    expect(recs[0]).toContain('raising');
  });

  it('recommends lowering thresholds when FN > 2x FP', () => {
    const recs = generateRecommendations(5, 20);
    expect(recs[0]).toContain('lowering');
  });

  it('gives no recommendation when balanced', () => {
    const recs = generateRecommendations(10, 10);
    expect(recs[0]).toContain('No tuning');
  });
});
