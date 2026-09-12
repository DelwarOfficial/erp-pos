import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  companyId: string;
  userId?: string;
  deviceId?: string;
  branchIds: string[];
  /** Company-wide branch access, derived from the current database user scope. */
  allBranches?: boolean;
  isGlobal: boolean;
  correlationId: string;
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

// REMOVED: enterTenantContext() (AsyncLocalStorage.enterWith wrapper).
// enterWith() sets the store only for the current async context and its
// future children — it does NOT propagate back to the caller's continuation
// after `await`, so tenant-scoped queries after `await authenticateRequest()`
// ran without context (TENANT_CONTEXT_REQUIRED), and a stale store could leak
// across requests sharing the context. Use tenantStorage.run() via
// runInTenantContext()/withTenant()/withAuthenticatedTenant() instead.

export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

export function requireTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) throw new Error('TenantContext is required but missing. Wrap the call in withTenant().');
  return ctx;
}
