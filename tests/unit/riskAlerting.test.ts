// tests/unit/riskAlerting.test.ts
// Tests the risk alerting logic — verifies that alerts trigger correctly
// when precision/recall/FP-count/FN-loss thresholds are breached.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db + provider registry + audit
vi.mock('@/lib/db', () => ({
  db: {
    riskAssessment: {
      findMany: vi.fn(),
    },
  },
}));
vi.mock('@/adapters', () => ({
  providerRegistry: {
    getEmail: vi.fn(() => null),
  },
}));
vi.mock('@/lib/audit', () => ({
  recordSecurityEvent: vi.fn(),
}));

import { db } from '@/lib/db';
import { evaluateRiskAlerts } from '@/lib/risk/alerting';

// Helper: build mock assessments with given TP/TN/FP/FN counts
function buildAssessments(config: { tp: number; tn: number; fp: number; fn: number; fnLoss?: number }) {
  const assessments: any[] = [];

  // True Positives: flagged + negative outcome
  for (let i = 0; i < config.tp; i++) {
    assessments.push({
      decision: 'review',
      outcomes: [{ outcomeType: 'charged_back', outcomeAmount: '1000', recordedAt: new Date() }],
    });
  }
  // True Negatives: not flagged + positive outcome
  for (let i = 0; i < config.tn; i++) {
    assessments.push({
      decision: 'allow',
      outcomes: [{ outcomeType: 'completed', outcomeAmount: '0', recordedAt: new Date() }],
    });
  }
  // False Positives: flagged + positive outcome
  for (let i = 0; i < config.fp; i++) {
    assessments.push({
      decision: 'review',
      outcomes: [{ outcomeType: 'completed', outcomeAmount: '0', recordedAt: new Date() }],
    });
  }
  // False Negatives: not flagged + negative outcome
  for (let i = 0; i < config.fn; i++) {
    assessments.push({
      decision: 'allow',
      outcomes: [{ outcomeType: 'fraud_confirmed', outcomeAmount: String(config.fnLoss ?? 50000), recordedAt: new Date() }],
    });
  }

  return assessments;
}

describe('Risk Alerting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('triggers LOW_PRECISION alert when precision < 50%', async () => {
    // 1 TP + 4 FP = precision 20%
    vi.mocked(db.riskAssessment).findMany.mockResolvedValueOnce(buildAssessments({ tp: 1, tn: 5, fp: 4, fn: 0 }));

    const alerts = await evaluateRiskAlerts();
    const lowPrecision = alerts.find((a) => a.type === 'LOW_PRECISION');
    expect(lowPrecision).toBeDefined();
    expect(lowPrecision?.severity).toBe('warning');
    expect(lowPrecision?.message).toContain('20.0%');
  });

  it('triggers LOW_RECALL alert when recall < 90%', async () => {
    // 1 TP + 4 FN = recall 20%
    vi.mocked(db.riskAssessment).findMany.mockResolvedValueOnce(buildAssessments({ tp: 1, tn: 5, fp: 0, fn: 4 }));

    const alerts = await evaluateRiskAlerts();
    const lowRecall = alerts.find((a) => a.type === 'LOW_RECALL');
    expect(lowRecall).toBeDefined();
    expect(lowRecall?.severity).toBe('critical');
    expect(lowRecall?.message).toContain('20.0%');
  });

  it('triggers HIGH_FP_COUNT alert when FP >= 10', async () => {
    vi.mocked(db.riskAssessment).findMany.mockResolvedValueOnce(buildAssessments({ tp: 5, tn: 5, fp: 10, fn: 0 }));

    const alerts = await evaluateRiskAlerts();
    const highFp = alerts.find((a) => a.type === 'HIGH_FP_COUNT');
    expect(highFp).toBeDefined();
    expect(highFp?.message).toContain('10 false positives');
  });

  it('triggers HIGH_FN_LOSS alert when FN loss >= 100,000 BDT', async () => {
    vi.mocked(db.riskAssessment).findMany.mockResolvedValueOnce(buildAssessments({ tp: 1, tn: 5, fp: 0, fn: 2, fnLoss: 80000 }));

    const alerts = await evaluateRiskAlerts();
    const highFnLoss = alerts.find((a) => a.type === 'HIGH_FN_LOSS');
    expect(highFnLoss).toBeDefined();
    expect(highFnLoss?.severity).toBe('critical');
    expect(highFnLoss?.message).toContain('160,000'); // 2 FNs × 80,000 each
  });

  it('does not trigger alerts when performance is good', async () => {
    // 5 TP + 0 FP + 0 FN = precision 100%, recall 100%
    vi.mocked(db.riskAssessment).findMany.mockResolvedValueOnce(buildAssessments({ tp: 5, tn: 10, fp: 0, fn: 0 }));

    const alerts = await evaluateRiskAlerts();
    expect(alerts.length).toBe(0);
  });

  it('does not trigger LOW_PRECISION when too few samples', async () => {
    // Only 3 flagged (below the min-5 threshold for precision alerts)
    vi.mocked(db.riskAssessment).findMany.mockResolvedValueOnce(buildAssessments({ tp: 1, tn: 5, fp: 2, fn: 0 }));

    const alerts = await evaluateRiskAlerts();
    const lowPrecision = alerts.find((a) => a.type === 'LOW_PRECISION');
    expect(lowPrecision).toBeUndefined(); // not enough samples
  });

  it('does not trigger LOW_RECALL when too few negative outcomes', async () => {
    // Only 2 negative outcomes (below the min-3 threshold for recall alerts)
    vi.mocked(db.riskAssessment).findMany.mockResolvedValueOnce(buildAssessments({ tp: 0, tn: 10, fp: 0, fn: 2 }));

    const alerts = await evaluateRiskAlerts();
    const lowRecall = alerts.find((a) => a.type === 'LOW_RECALL');
    expect(lowRecall).toBeUndefined();
  });

  it('includes correct metrics in alert', async () => {
    vi.mocked(db.riskAssessment).findMany.mockResolvedValueOnce(buildAssessments({ tp: 2, tn: 5, fp: 8, fn: 1, fnLoss: 50000 }));

    const alerts = await evaluateRiskAlerts();
    const alert = alerts[0];
    expect(alert.metrics.truePositives).toBe(2);
    expect(alert.metrics.trueNegatives).toBe(5);
    expect(alert.metrics.falsePositives).toBe(8);
    expect(alert.metrics.falseNegatives).toBe(1);
    expect(alert.metrics.fnLossAmount).toBe(50000);
    expect(alert.metrics.windowDays).toBe(7);
  });
});
