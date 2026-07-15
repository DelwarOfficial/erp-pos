// src/lib/retention/job.ts
// Data-retention / anonymization job — per §13 GDPR-style compliance.
// Hard-deletes very old (90+ day) audit/security events, anonymizes
// customer PII for accounts closed > 12 months.

import { db } from '@/lib/db';

const AUDIT_RETENTION_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS ?? '90', 10);
const CUSTOMER_ANONYMIZE_DAYS = parseInt(process.env.CUSTOMER_ANONYMIZE_DAYS ?? '365', 10);

type RetentionPolicy = 'default' | 'audit_only' | 'pii_only';

export async function runRetentionJob(policy: RetentionPolicy = 'default'): Promise<{
  auditEventsDeleted: number;
  securityEventsDeleted: number;
  customersAnonymized: number;
}> {
  const auditCutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const customerCutoff = new Date(Date.now() - CUSTOMER_ANONYMIZE_DAYS * 24 * 60 * 60 * 1000);

  let auditEventsDeleted = 0;
  let securityEventsDeleted = 0;
  let customersAnonymized = 0;

  if (policy === 'default' || policy === 'audit_only') {
    // Delete old audit log entries (90 days default per §13.3 retention policy)
    const auditResult = await db.auditLog.deleteMany({ where: { occurredAt: { lt: auditCutoff } } });
    auditEventsDeleted = auditResult.count;

    // Delete old security events (90 days — keep recent for forensic investigation)
    const securityResult = await db.securityEvent.deleteMany({ where: { occurredAt: { lt: auditCutoff } } });
    securityEventsDeleted = securityResult.count;
  }

  if (policy === 'default' || policy === 'pii_only') {
    // Anonymize customer PII for accounts closed > 12 months
    const staleCustomers = await db.customer.findMany({
      where: {
        isActive: false,
        updatedAt: { lt: customerCutoff },
      },
      select: { id: true },
      take: 500,
    });

    for (const c of staleCustomers) {
      await db.customer.update({
        where: { id: c.id },
        data: {
          name: `[Anonymized ${c.id.slice(-6)}]`,
          phone: null,
          email: null,
          address: null,
          taxIdentifier: null,
        },
      });
      customersAnonymized++;
    }
  }

  console.log('[retention-job] Completed', { policy, auditEventsDeleted, securityEventsDeleted, customersAnonymized });

  return { auditEventsDeleted, securityEventsDeleted, customersAnonymized };
}
