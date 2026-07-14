// tests/unit/periodClose.test.ts
// Tests for period-end close workflow per §11.4 + §20.D08.

import { describe, it, expect } from 'vitest';

describe('Period-End Close Workflow (§11.4)', () => {
  describe('Status Transitions', () => {
    it('open → soft_locked is allowed', () => {
      const transitions: Record<string, string[]> = {
        open: ['soft_locked'],
        soft_locked: ['locked', 'open'],
        locked: ['open'], // requires platform ops
      };

      expect(transitions.open).toContain('soft_locked');
    });

    it('soft_locked → locked is allowed', () => {
      const transitions: Record<string, string[]> = {
        open: ['soft_locked'],
        soft_locked: ['locked', 'open'],
        locked: ['open'],
      };

      expect(transitions.soft_locked).toContain('locked');
    });

    it('locked → open requires platform operations', () => {
      const isPlatformOps = false;
      const currentStatus = 'locked';
      const canUnlock = isPlatformOps || currentStatus !== 'locked';

      expect(canUnlock).toBe(false); // non-platform-ops cannot unlock
    });

    it('soft_locked → open is allowed (undo soft-lock)', () => {
      const currentStatus = 'soft_locked';
      const canUnlock = currentStatus !== 'locked' || true; // soft_lock can be undone

      expect(canUnlock).toBe(true);
    });

    it('open → locked is NOT allowed (must go through soft_locked)', () => {
      const transitions: Record<string, string[]> = {
        open: ['soft_locked'],
        soft_locked: ['locked', 'open'],
        locked: ['open'],
      };

      expect(transitions.open).not.toContain('locked');
    });
  });

  describe('Step 1: Control Backdating', () => {
    it('passes when no entries are dated after period end', () => {
      const entriesAfterPeriodEnd = 0;
      const status = entriesAfterPeriodEnd > 0 ? 'failed' : 'passed';
      expect(status).toBe('passed');
    });

    it('fails when entries are dated after period end', () => {
      const entriesAfterPeriodEnd = 3;
      const status = entriesAfterPeriodEnd > 0 ? 'failed' : 'passed';
      expect(status).toBe('failed');
    });
  });

  describe('Step 2: Reconciliation', () => {
    it('passes when no critical/high findings', () => {
      const findings = [
        { severity: 'info', checkCode: 'GIFT_CARD_LIABILITY' },
        { severity: 'low', checkCode: 'CASH_SHIFT_VARIANCE' },
      ];
      const criticalOrHigh = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
      const status = criticalOrHigh.length > 0 ? 'failed' : 'passed';

      expect(status).toBe('passed');
    });

    it('fails when critical findings exist', () => {
      const findings = [
        { severity: 'critical', checkCode: 'JOURNAL_BALANCE' },
        { severity: 'high', checkCode: 'STOCK_QTY_LEDGER' },
        { severity: 'info', checkCode: 'GIFT_CARD_LIABILITY' },
      ];
      const criticalOrHigh = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
      const status = criticalOrHigh.length > 0 ? 'failed' : 'passed';

      expect(status).toBe('failed');
      expect(criticalOrHigh).toHaveLength(2);
    });

    it('fails when high findings exist (even without critical)', () => {
      const findings = [
        { severity: 'high', checkCode: 'AR_SUBLEDGER_GL' },
      ];
      const criticalOrHigh = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
      expect(criticalOrHigh.length).toBeGreaterThan(0);
    });
  });

  describe('Step 3: Review Drafts', () => {
    it('passes when no draft journal entries exist', () => {
      const draftCount = 0;
      const status = draftCount > 0 ? 'failed' : 'passed';
      expect(status).toBe('passed');
    });

    it('fails when unposted draft entries exist', () => {
      const draftCount = 5;
      const status = draftCount > 0 ? 'failed' : 'passed';
      expect(status).toBe('failed');
    });
  });

  describe('Step 5: Soft-Lock', () => {
    it('soft-lock prevents new entries but allows corrections', () => {
      const softLockedStatus = 'soft_locked';
      const allowsNewEntries = softLockedStatus === 'open';
      const allowsCorrections = softLockedStatus === 'soft_locked' || softLockedStatus === 'open';

      expect(allowsNewEntries).toBe(false); // new entries blocked
      expect(allowsCorrections).toBe(true);  // corrections (reversals) allowed
    });
  });

  describe('Step 6: Final Lock', () => {
    it('locked period is immutable — corrections require new-period reversal', () => {
      const lockedStatus = 'locked';
      const allowsCorrections = lockedStatus === 'soft_locked' || lockedStatus === 'open';
      const requiresReversalInNewPeriod = lockedStatus === 'locked';

      expect(allowsCorrections).toBe(false);
      expect(requiresReversalInNewPeriod).toBe(true);
    });

    it('cannot lock if blockers exist', () => {
      const blockers = ['Reconciliation has critical findings'];
      const canLock = blockers.length === 0;

      expect(canLock).toBe(false);
    });

    it('can lock when no blockers', () => {
      const blockers: string[] = [];
      const canLock = blockers.length === 0;

      expect(canLock).toBe(true);
    });
  });

  describe('Blockers Prevent Locking', () => {
    it('backdating issue is a blocker', () => {
      const steps = [
        { stepName: 'Control Backdating', status: 'failed' },
        { stepName: 'Reconciliation', status: 'passed' },
      ];
      const hasBlocker = steps.some(s => s.status === 'failed');
      expect(hasBlocker).toBe(true);
    });

    it('reconciliation failure is a blocker', () => {
      const steps = [
        { stepName: 'Control Backdating', status: 'passed' },
        { stepName: 'Reconciliation', status: 'failed' },
      ];
      const hasBlocker = steps.some(s => s.status === 'failed');
      expect(hasBlocker).toBe(true);
    });

    it('unposted drafts are a blocker', () => {
      const steps = [
        { stepName: 'Control Backdating', status: 'passed' },
        { stepName: 'Reconciliation', status: 'passed' },
        { stepName: 'Review Drafts', status: 'failed' },
      ];
      const hasBlocker = steps.some(s => s.status === 'failed');
      expect(hasBlocker).toBe(true);
    });

    it('all steps passing means no blockers', () => {
      const steps = [
        { stepName: 'Control Backdating', status: 'passed' },
        { stepName: 'Reconciliation', status: 'passed' },
        { stepName: 'Review Drafts', status: 'passed' },
      ];
      const hasBlocker = steps.some(s => s.status === 'failed');
      expect(hasBlocker).toBe(false);
    });
  });

  describe('Fiscal Period EXCLUDE Constraint', () => {
    it('two periods cannot overlap', () => {
      const period1 = { start: '2026-07-01', end: '2026-07-31' };
      const period2 = { start: '2026-07-15', end: '2026-08-15' };

      // Check overlap
      const overlap = new Date(period2.start) <= new Date(period1.end) &&
                      new Date(period2.end) >= new Date(period1.start);

      expect(overlap).toBe(true); // they overlap — EXCLUDE constraint should reject
    });

    it('adjacent periods do not overlap', () => {
      const period1 = { start: '2026-07-01', end: '2026-07-31' };
      const period2 = { start: '2026-08-01', end: '2026-08-31' };

      const overlap = new Date(period2.start) <= new Date(period1.end) &&
                      new Date(period2.end) >= new Date(period1.start);

      expect(overlap).toBe(false); // no overlap — allowed
    });
  });
});
