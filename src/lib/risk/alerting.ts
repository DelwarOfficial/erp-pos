// src/lib/risk/alerting.ts
// Risk performance alerting — runs on a schedule (BullMQ worker) and checks
// the 7-day rolling FP/FN report. Triggers alerts when:
//   - precision < 50% (too many false positives — customers are being wrongly flagged)
//   - recall < 90% (too many false negatives — real fraud is slipping through)
//   - FP count > 10 in 7 days (absolute threshold regardless of precision)
//   - FN loss amount > 100,000 BDT in 7 days (financial impact threshold)
//
// Alerts are sent via the provider registry (email + recorded as security event).

import { db } from '@/lib/db';
import { providerRegistry } from '@/adapters';
import { recordSecurityEvent } from '@/lib/audit';

// Configurable thresholds (env vars)
const ALERT_PRECISION_THRESHOLD = parseFloat(process.env.RISK_ALERT_PRECISION_THRESHOLD ?? '0.5');
const ALERT_RECALL_THRESHOLD = parseFloat(process.env.RISK_ALERT_RECALL_THRESHOLD ?? '0.9');
const ALERT_FP_COUNT_THRESHOLD = parseInt(process.env.RISK_ALERT_FP_COUNT_THRESHOLD ?? '10', 10);
const ALERT_FN_LOSS_THRESHOLD = parseInt(process.env.RISK_ALERT_FN_LOSS_THRESHOLD ?? '100000', 10);
const ALERT_WINDOW_DAYS = parseInt(process.env.RISK_ALERT_WINDOW_DAYS ?? '7', 10);
const ALERT_RECIPIENT_EMAIL = process.env.RISK_ALERT_RECIPIENT_EMAIL ?? '';

export interface RiskAlert {
  type: 'LOW_PRECISION' | 'LOW_RECALL' | 'HIGH_FP_COUNT' | 'HIGH_FN_LOSS';
  severity: 'warning' | 'critical';
  message: string;
  metrics: {
    precision: number | null;
    recall: number | null;
    truePositives: number;
    trueNegatives: number;
    falsePositives: number;
    falseNegatives: number;
    fnLossAmount: number;
    windowDays: number;
  };
  triggeredAt: string;
}

/**
 * Evaluates the 7-day rolling risk performance and triggers alerts if any
 * thresholds are breached. Returns the list of alerts that were triggered.
 * Designed to be called by the BullMQ reconciliation worker on a daily schedule.
 */
export async function evaluateRiskAlerts(): Promise<RiskAlert[]> {
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Fetch assessments + outcomes in the window
  const assessments = await db.riskAssessment.findMany({
    where: {
      assessedAt: { gte: fromDate, lte: toDate },
    },
    include: { outcomes: true },
  }).catch(() => []);

  let truePositives = 0, trueNegatives = 0, falsePositives = 0, falseNegatives = 0;
  let fnLossAmount = 0;

  for (const a of assessments) {
    if (a.outcomes.length === 0) continue;
    const latestOutcome = a.outcomes.sort((x, y) => y.recordedAt.getTime() - x.recordedAt.getTime())[0];
    const isNegative = ['charged_back', 'refunded', 'fraud_confirmed'].includes(latestOutcome.outcomeType);
    const isPositive = ['no_issue', 'completed'].includes(latestOutcome.outcomeType);
    const isFlagged = a.decision === 'review' || a.decision === 'block';

    if (isFlagged && isNegative) truePositives++;
    else if (!isFlagged && isPositive) trueNegatives++;
    else if (isFlagged && isPositive) falsePositives++;
    else if (!isFlagged && isNegative) {
      falseNegatives++;
      fnLossAmount += parseFloat(String(latestOutcome.outcomeAmount ?? '0'));
    }
  }

  const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : null;
  const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : null;

  const alerts: RiskAlert[] = [];
  const triggeredAt = new Date().toISOString();

  // Check precision threshold
  if (precision !== null && precision < ALERT_PRECISION_THRESHOLD && (truePositives + falsePositives) >= 5) {
    alerts.push({
      type: 'LOW_PRECISION',
      severity: 'warning',
      message: `Risk precision is ${(precision * 100).toFixed(1)}% (below ${ALERT_PRECISION_THRESHOLD * 100}% threshold) — too many false positives. Consider raising RISK_DECISION_REVIEW_THRESHOLD or reducing score increments for over-triggering rules.`,
      metrics: { precision, recall, truePositives, trueNegatives, falsePositives, falseNegatives, fnLossAmount, windowDays: ALERT_WINDOW_DAYS },
      triggeredAt,
    });
  }

  // Check recall threshold
  if (recall !== null && recall < ALERT_RECALL_THRESHOLD && (truePositives + falseNegatives) >= 3) {
    alerts.push({
      type: 'LOW_RECALL',
      severity: 'critical',
      message: `Risk recall is ${(recall * 100).toFixed(1)}% (below ${ALERT_RECALL_THRESHOLD * 100}% threshold) — real fraud is slipping through. Consider lowering RISK_DECISION_REVIEW_THRESHOLD or adding new rules.`,
      metrics: { precision, recall, truePositives, trueNegatives, falsePositives, falseNegatives, fnLossAmount, windowDays: ALERT_WINDOW_DAYS },
      triggeredAt,
    });
  }

  // Check absolute FP count threshold
  if (falsePositives >= ALERT_FP_COUNT_THRESHOLD) {
    alerts.push({
      type: 'HIGH_FP_COUNT',
      severity: 'warning',
      message: `${falsePositives} false positives in the last ${ALERT_WINDOW_DAYS} days (threshold: ${ALERT_FP_COUNT_THRESHOLD}) — review the FP/FN report and tune thresholds.`,
      metrics: { precision, recall, truePositives, trueNegatives, falsePositives, falseNegatives, fnLossAmount, windowDays: ALERT_WINDOW_DAYS },
      triggeredAt,
    });
  }

  // Check FN loss amount threshold
  if (fnLossAmount >= ALERT_FN_LOSS_THRESHOLD) {
    alerts.push({
      type: 'HIGH_FN_LOSS',
      severity: 'critical',
      message: `False-negative loss amount is BDT ${fnLossAmount.toLocaleString()} in the last ${ALERT_WINDOW_DAYS} days (threshold: BDT ${ALERT_FN_LOSS_THRESHOLD.toLocaleString()}) — significant fraud losses. Tune thresholds to catch more.`,
      metrics: { precision, recall, truePositives, trueNegatives, falsePositives, falseNegatives, fnLossAmount, windowDays: ALERT_WINDOW_DAYS },
      triggeredAt,
    });
  }

  // Send alerts via email + record as security events
  // Fetch first active company for the security event record (alerts are global
  // but security_events table requires a companyId)
  let alertCompanyId: string | undefined;
  try {
    const firstCompany = await db.company.findFirst({
      where: { status: 'active' },
      select: { id: true },
    });
    alertCompanyId = firstCompany?.id;
  } catch { /* ignore */ }

  for (const alert of alerts) {
    // Record as security event (always — if we have a companyId)
    if (alertCompanyId) {
      try {
        await recordSecurityEvent({
          eventType: `risk_alert_${alert.type.toLowerCase()}`,
          severity: alert.severity,
          metadata: alert as unknown as Record<string, unknown>,
          companyId: alertCompanyId,
        });
      } catch (e) {
        console.error('[risk-alerting] Failed to record security event:', e);
      }
    }

    // Send email alert (if recipient configured)
    if (ALERT_RECIPIENT_EMAIL) {
      try {
        // Ensure providers are registered (idempotent)
        const { registerProviders } = await import('@/adapters/providers');
        registerProviders();
        // Try real providers first, fall back to mock for dev/test
        const emailProvider =
          providerRegistry.getEmail('resend') ??
          providerRegistry.getEmail('sendgrid') ??
          providerRegistry.getEmail('aws_ses') ??
          providerRegistry.getEmail('mock_email');
        if (emailProvider) {
          await emailProvider.sendEmail({
            to: ALERT_RECIPIENT_EMAIL,
            subject: `[${alert.severity.toUpperCase()}] Risk Alert: ${alert.type}`,
            htmlBody: `
              <h2>Risk Performance Alert</h2>
              <p><strong>Type:</strong> ${alert.type}</p>
              <p><strong>Severity:</strong> ${alert.severity}</p>
              <p><strong>Message:</strong> ${alert.message}</p>
              <h3>Metrics (last ${alert.metrics.windowDays} days)</h3>
              <ul>
                <li>Precision: ${alert.metrics.precision !== null ? (alert.metrics.precision * 100).toFixed(1) + '%' : 'N/A'}</li>
                <li>Recall: ${alert.metrics.recall !== null ? (alert.metrics.recall * 100).toFixed(1) + '%' : 'N/A'}</li>
                <li>True Positives: ${alert.metrics.truePositives}</li>
                <li>True Negatives: ${alert.metrics.trueNegatives}</li>
                <li>False Positives: ${alert.metrics.falsePositives}</li>
                <li>False Negatives: ${alert.metrics.falseNegatives}</li>
                <li>FN Loss Amount: BDT ${alert.metrics.fnLossAmount.toLocaleString()}</li>
              </ul>
              <p>View the full report at <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/dashboard/risk-tuning">Risk Tuning Dashboard</a></p>
            `,
          });
          console.log(`[risk-alerting] Email alert sent for ${alert.type} via ${emailProvider.code}`);
        } else {
          console.warn(`[risk-alerting] No email provider registered — alert for ${alert.type} recorded as security event only`);
        }
      } catch (e) {
        console.error(`[risk-alerting] Failed to send email alert for ${alert.type}:`, e);
      }
    }

    // Send Slack/notification alert (fan-out to all registered notification providers)
    try {
      const notifications = providerRegistry.getAllNotifications();
      const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/dashboard/risk-tuning`;
      const fields = [
        { label: 'Precision', value: alert.metrics.precision !== null ? `${(alert.metrics.precision * 100).toFixed(1)}%` : 'N/A' },
        { label: 'Recall', value: alert.metrics.recall !== null ? `${(alert.metrics.recall * 100).toFixed(1)}%` : 'N/A' },
        { label: 'True Positives', value: String(alert.metrics.truePositives) },
        { label: 'True Negatives', value: String(alert.metrics.trueNegatives) },
        { label: 'False Positives', value: String(alert.metrics.falsePositives) },
        { label: 'False Negatives', value: String(alert.metrics.falseNegatives) },
        { label: 'FN Loss (BDT)', value: alert.metrics.fnLossAmount.toLocaleString() },
        { label: 'Window', value: `${alert.metrics.windowDays} days` },
      ];

      for (const notifier of notifications) {
        try {
          const result = await notifier.sendNotification({
            severity: alert.severity,
            title: `Risk Alert: ${alert.type}`,
            message: alert.message,
            fields,
            url: dashboardUrl,
          });
          if (result.delivered) {
            console.log(`[risk-alerting] Notification sent for ${alert.type} via ${notifier.code}`);
          } else {
            console.warn(`[risk-alerting] Notification failed for ${alert.type} via ${notifier.code}: ${result.error}`);
          }
        } catch (e) {
          console.error(`[risk-alerting] Notification error for ${alert.type} via ${notifier.code}:`, e);
        }
      }
    } catch (e) {
      console.error(`[risk-alerting] Failed to send notifications for ${alert.type}:`, e);
    }
  }

  return alerts;
}
