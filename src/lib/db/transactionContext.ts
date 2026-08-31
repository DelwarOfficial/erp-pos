import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  companyId: string;
  userId?: string;
  deviceId?: string;
  branchIds: string[];
  isGlobal: boolean;
  correlationId: string;
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function enterTenantContext(ctx: TenantContext): void {
  tenantStorage.enterWith(ctx);
}

export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

export function requireTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) throw new Error('TenantContext is required but missing. Wrap the call in withTenant().');
  return ctx;
}
