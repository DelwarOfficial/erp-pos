// src/lib/reconciliation/scheduler.ts
// Periodic reconciliation scheduler — enqueues and runs reconciliation checks.
// Per §6 rule 13 + §5.17 reconciliation_runs + reconciliation_findings.
// Also runs daily risk alert evaluation.

import { systemDb as db } from '@/lib/db';
import { runReconciliation } from '@/lib/reconciliation/checks';
import { enqueue, QUEUE_NAMES } from '@/lib/queue';
import { evaluateRiskAlerts } from '@/lib/risk/alerting';
import { errorMeta, logger } from '@/lib/logging';

const SCHEDULE = [
  // High-frequency integrity checks (every hour)
  { cron: '0 * * * *', runType: 'nightly' as const },
  // Daily end-of-day checks (10pm) — full pass
  { cron: '0 22 * * *', runType: 'nightly' as const },
];

/**
 * Runs scheduled reconciliation across all active companies.
 * Called by the BullMQ reconciliation worker.
 * Also evaluates risk alerts (precision/recall thresholds) on each run.
 */
export async function runScheduledReconciliation(): Promise<{ companies: number; totalFindings: number; riskAlerts: number }> {
  const companies = await db.company.findMany({ where: { status: 'active' }, select: { id: true } });
  let totalFindings = 0;

  for (const company of companies) {
    try {
      const result = await runReconciliation(company.id, 'nightly', 'system:scheduler');
      totalFindings += result.findings.length;
    } catch (e) {
      logger.error('[reconciliation-scheduler] failed for a company', { company_id: company.id, ...errorMeta(e) });
    }
  }

  // Evaluate risk alerts (precision/recall thresholds)
  let riskAlerts = 0;
  try {
    const alerts = await evaluateRiskAlerts();
    riskAlerts = alerts.length;
    if (riskAlerts > 0) {
      logger.info('[reconciliation-scheduler] risk alerts triggered', { count: riskAlerts });
    }
  } catch (e) {
    logger.error('[reconciliation-scheduler] risk alert evaluation failed', errorMeta(e));
  }

  return { companies: companies.length, totalFindings, riskAlerts };
}

export function enqueueReconciliationRun(): void {
  enqueue(QUEUE_NAMES.RECONCILIATION, 'run-all', {}).catch(e => logger.error('[reconciliation-scheduler] enqueue failed', errorMeta(e)));
}

export { SCHEDULE };
