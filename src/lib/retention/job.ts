// src/lib/retention/job.ts
// Data-retention / anonymization job — per §13 GDPR-style compliance.
//
// The job runs per company. It previously ran once on systemDb with no tenant
// scope at all -- `deleteMany({ occurredAt: { lt: cutoff } })` swept every
// company at once -- so one process-wide environment variable imposed a single
// retention policy on every tenant. A tenant with a seven-year statutory
// obligation had its security events destroyed at 90 days because another
// tenant's default applied, and nothing recorded whose data was destroyed.
//
// Retention periods now come from configuration_values per company, falling
// back to the environment defaults. Every subject is checked against active
// legal holds before anything is deleted or anonymized (see ./legalHold).

import { systemDb as db } from '@/lib/db';
import { collectLegalHolds, type CompanyLegalHolds } from './legalHold';

const DEFAULT_AUDIT_RETENTION_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS ?? '90', 10);
const DEFAULT_CUSTOMER_ANONYMIZE_DAYS = parseInt(process.env.CUSTOMER_ANONYMIZE_DAYS ?? '365', 10);
const CUSTOMER_BATCH_SIZE = 500;

type RetentionPolicy = 'default' | 'audit_only' | 'pii_only';

export interface RetentionCompanyResult {
  companyId: string;
  auditEventsDeleted: number;
  securityEventsDeleted: number;
  customersAnonymized: number;
  /** Subjects skipped because an active legal hold covers them. */
  heldBack: number;
}

export interface RetentionResult {
  auditEventsDeleted: number;
  securityEventsDeleted: number;
  customersAnonymized: number;
  heldBack: number;
  companies: RetentionCompanyResult[];
}

/** Retention periods for one company: tenant configuration, else the deployment default. */
async function retentionDaysFor(companyId: string): Promise<{ audit: number; customer: number }> {
  const result = { audit: DEFAULT_AUDIT_RETENTION_DAYS, customer: DEFAULT_CUSTOMER_ANONYMIZE_DAYS };
  try {
    const values = await db.configurationValue.findMany({
      where: { companyId, definitionKey: { in: ['retention.audit_days', 'retention.customer_anonymize_days'] } },
      select: { definitionKey: true, value: true },
    });
    for (const value of values) {
      const parsed = parseInt(value.value.replace(/"/g, ''), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) continue;
      if (value.definitionKey === 'retention.audit_days') result.audit = parsed;
      if (value.definitionKey === 'retention.customer_anonymize_days') result.customer = parsed;
    }
  } catch {
    // Configuration unavailable: keep the deployment defaults rather than
    // failing the whole job for one company.
  }
  return result;
}

export async function runRetentionJob(policy: RetentionPolicy = 'default'): Promise<RetentionResult> {
  const companies = await db.company.findMany({ where: { status: 'active' }, select: { id: true } });

  const results: RetentionCompanyResult[] = [];
  for (const company of companies) {
    results.push(await runForCompany(company.id, policy));
  }

  const total = results.reduce((sum, result) => ({
    auditEventsDeleted: sum.auditEventsDeleted + result.auditEventsDeleted,
    securityEventsDeleted: sum.securityEventsDeleted + result.securityEventsDeleted,
    customersAnonymized: sum.customersAnonymized + result.customersAnonymized,
    heldBack: sum.heldBack + result.heldBack,
  }), { auditEventsDeleted: 0, securityEventsDeleted: 0, customersAnonymized: 0, heldBack: 0 });

  return { ...total, companies: results };
}

async function runForCompany(companyId: string, policy: RetentionPolicy): Promise<RetentionCompanyResult> {
  const days = await retentionDaysFor(companyId);
  const auditCutoff = new Date(Date.now() - days.audit * 24 * 60 * 60 * 1000);
  const customerCutoff = new Date(Date.now() - days.customer * 24 * 60 * 60 * 1000);
  const holds = await collectLegalHolds(companyId);

  const result: RetentionCompanyResult = {
    companyId, auditEventsDeleted: 0, securityEventsDeleted: 0, customersAnonymized: 0, heldBack: 0,
  };

  if (policy === 'default' || policy === 'audit_only') {
    // MariaDB audit rows are protected by append-only triggers. Purging there
    // requires a separately privileged archive workflow, never the app login.
    if (!/^mysql:/i.test(process.env.DATABASE_URL ?? '') && !holds.blocksAuditLogs) {
      const deleted = await db.auditLog.deleteMany({ where: { companyId, occurredAt: { lt: auditCutoff } } });
      result.auditEventsDeleted = deleted.count;
    }

    if (!holds.blocksSecurityEvents) {
      const deleted = await db.securityEvent.deleteMany({ where: { companyId, occurredAt: { lt: auditCutoff } } });
      result.securityEventsDeleted = deleted.count;
    }
  }

  if (policy === 'default' || policy === 'pii_only') {
    const stale = await db.customer.findMany({
      where: { companyId, isActive: false, updatedAt: { lt: customerCutoff } },
      select: { id: true },
      take: CUSTOMER_BATCH_SIZE,
    });

    const anonymizable = stale.filter(customer => !holds.blocksCustomer(customer.id));
    result.heldBack += stale.length - anonymizable.length;

    // One transaction for the batch: a mid-batch failure previously left some
    // customers anonymized and the rest not, with no record of where it stopped.
    if (anonymizable.length > 0) {
      await db.$transaction(anonymizable.map(customer => db.customer.update({
        where: { id: customer.id },
        data: {
          name: `[Anonymized ${customer.id.slice(-6)}]`,
          phone: null,
          email: null,
          address: null,
          taxIdentifier: null,
        },
      })));
      result.customersAnonymized = anonymizable.length;
    }
  }

  return result;
}
