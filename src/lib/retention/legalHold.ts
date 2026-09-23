// Legal-hold enforcement.
//
// legal_holds was a write-only table: holds were created, listed, counted and
// released, and nothing anywhere read them to block anything. Counsel could
// place a litigation hold on a customer's records and the retention job would
// anonymize that customer's name, phone, email, address and tax identifier and
// hard-delete the related security events the same night, while the UI went on
// showing the hold as active. That is spoliation, and the failure was invisible
// precisely when it mattered.
//
// A hold names an entity by (entityType, entityId) and is active until
// releasedAt is set. Two forms matter here:
//
//   a hold on a specific subject   entityType 'customer', entityId <customer>
//   a blanket hold on the company  entityType 'company',  entityId <company>
//
// A blanket hold, or a hold naming the audit or security-event stream, stops
// the corresponding purge for the whole company.

import { systemDb as db } from '@/lib/db';

/** Entity types that block the audit-log purge when held. */
const AUDIT_HOLD_TYPES = new Set(['company', 'audit_log', 'audit_logs']);
/** Entity types that block the security-event purge when held. */
const SECURITY_HOLD_TYPES = new Set(['company', 'security_event', 'security_events']);
const CUSTOMER_HOLD_TYPES = new Set(['customer', 'customers']);

export interface CompanyLegalHolds {
  /** True when an active hold stops audit-log deletion for this company. */
  blocksAuditLogs: boolean;
  /** True when an active hold stops security-event deletion for this company. */
  blocksSecurityEvents: boolean;
  /** True when this specific customer is held (directly or by a company-wide hold). */
  blocksCustomer: (customerId: string) => boolean;
  /** Every active hold, for logging and for the caller's own decisions. */
  active: Array<{ id: string; entityType: string; entityId: string }>;
}

export async function collectLegalHolds(companyId: string): Promise<CompanyLegalHolds> {
  const active = await db.legalHold.findMany({
    where: { companyId, releasedAt: null },
    select: { id: true, entityType: true, entityId: true },
  });

  const companyWide = active.some(hold => hold.entityType === 'company' && hold.entityId === companyId);
  const heldCustomers = new Set(
    active.filter(hold => CUSTOMER_HOLD_TYPES.has(hold.entityType)).map(hold => hold.entityId),
  );

  return {
    blocksAuditLogs: companyWide || active.some(hold => AUDIT_HOLD_TYPES.has(hold.entityType)),
    blocksSecurityEvents: companyWide || active.some(hold => SECURITY_HOLD_TYPES.has(hold.entityType)),
    blocksCustomer: (customerId: string) => companyWide || heldCustomers.has(customerId),
    active,
  };
}

/**
 * True when an active hold covers this exact entity, or the whole company.
 * Use before any deletion, anonymization or erasure of a named subject.
 */
export async function isUnderLegalHold(
  companyId: string,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  const held = await db.legalHold.findFirst({
    where: {
      companyId,
      releasedAt: null,
      OR: [
        { entityType, entityId },
        { entityType: 'company', entityId: companyId },
      ],
    },
    select: { id: true },
  });
  return held !== null;
}
