// src/lib/audit/index.ts
// Append-only audit logger per §5.15 audit_logs.
// Application role has INSERT/SELECT only — never UPDATE/DELETE.

import { db } from '../db';
import { getTenantContext } from '../db/transaction';

export interface AuditParams {
  action: string;
  entityType: string;
  entityId: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  clientIp?: string;
  syncIp?: string;
  userAgent?: string;
}

/**
 * Write an audit log entry. Must be called inside withTenant() — reads the
 * TenantContext for company_id/user_id/device_id/correlation_id.
 *
 * In Postgres 16 production, this would be a SECURITY DEFINER function
 * `append_audit_log()` that validates the current_setting('app.company_id')
 * matches the row being inserted. SQLite sandbox writes directly.
 */
export async function audit(params: AuditParams): Promise<void> {
  const ctx = getTenantContext();
  if (!ctx) {
    throw new Error('audit() must be called inside withTenant()');
  }
  await db.auditLog.create({
    data: {
      companyId: ctx.companyId,
      userId: ctx.userId ?? null,
      deviceId: ctx.deviceId ?? null,
      correlationId: ctx.correlationId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      beforeValue: params.beforeValue !== undefined ? JSON.stringify(params.beforeValue) : null,
      afterValue: params.afterValue !== undefined ? JSON.stringify(params.afterValue) : null,
      clientIp: params.clientIp ?? ctx.ip ?? null,
      syncIp: params.syncIp ?? null,
      userAgent: params.userAgent ?? ctx.userAgent ?? null,
    },
  });
}

export interface SecurityEventParams {
  eventType: string;
  severity: 'info' | 'warning' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
  userId?: string;
  deviceId?: string;
  companyId?: string; // for unauthenticated events
  ip?: string;
  userAgent?: string;
}

export async function recordSecurityEvent(params: SecurityEventParams): Promise<void> {
  const ctx = getTenantContext();
  const companyId = params.companyId ?? ctx?.companyId;
  if (!companyId) {
    throw new Error('recordSecurityEvent requires a companyId (from context or param)');
  }
  await db.securityEvent.create({
    data: {
      companyId,
      userId: params.userId ?? ctx?.userId ?? null,
      deviceId: params.deviceId ?? ctx?.deviceId ?? null,
      eventType: params.eventType,
      severity: params.severity,
      ipAddress: params.ip ?? ctx?.ip ?? null,
      userAgent: params.userAgent ?? ctx?.userAgent ?? null,
      metadata: JSON.stringify(params.metadata ?? {}),
    },
  });
}
