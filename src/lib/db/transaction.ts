// src/lib/db/transaction.ts
// Request-scoped transaction wrapper. Sets the tenant context (RLS-equivalent)
// before every transaction, then runs the unit of work inside a single
// Serializable transaction.
//
// Blueprint §5 (M0 task 3) requires set_config('app.company_id', ...) with
// `true` (local) before every transaction. In SQLite (sandbox) we emulate
// RLS by:
//   1. Forcing every query inside the unit of work to go through `tx`, which
//      is the Prisma transaction client — no module may import the unrestricted
//      `db` client for tenant-scoped work.
//   2. Storing the TenantContext on AsyncLocalStorage so downstream code
//      (audit logger, security event recorder, idempotency) can read it
//      without re-parsing the request.
//
// In production (Postgres 16) the same wrapper would call SET LOCAL
// 'app.company_id', 'app.user_id', 'app.branch_ids', 'app.is_global' inside
// the transaction, and RLS policies would enforce row-level isolation
// regardless of application bugs. See docs/adr/0002-rls-via-middleware.md.

import { PrismaClient, Prisma } from '@prisma/client';
export type TransactionClient = Prisma.TransactionClient;
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { db } from './index';

export interface TenantContext {
  companyId: string;
  userId?: string;
  deviceId?: string;
  branchIds: string[]; // explicit allowed branches for this user
  isGlobal: boolean;   // platform_operations only
  correlationId: string;
  requestId: string;
  ip?: string;
  userAgent?: string;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

export function requireTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new Error(
      'TenantContext is required but missing. Wrap the call in withTenant().',
    );
  }
  return ctx;
}

export type UnitOfWork<T> = (tx: TransactionClient) => Promise<T>;

/**
 * Run a unit of work inside a single Prisma transaction with the given
 * TenantContext. The transaction isolation level is Serializable (matching
 * the blueprint §13.2 rule for inventory/serial/advance commands).
 *
 * In Postgres 16 production, this would also issue:
 *   SELECT set_config('app.company_id', $1, true);
 *   SELECT set_config('app.user_id', $2, true);
 *   SELECT set_config('app.branch_ids', $3, true);
 *   SELECT set_config('app.is_global', $4, true);
 * before any application query. RLS policies would then enforce row-level
 * isolation even if the application code forgot a WHERE clause.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  work: UnitOfWork<T>,
  options?: { isolationLevel?: 'Serializable' | 'ReadCommitted' },
): Promise<T> {
  return tenantStorage.run(ctx, async () => {
    const isolationLevel =
      options?.isolationLevel === 'ReadCommitted'
        ? 'ReadCommitted'
        : 'Serializable';

    return db.$transaction(async (tx) => {
      // In Postgres production we would execute:
      //   await tx.$executeRaw`SELECT set_config('app.company_id', ${ctx.companyId}, true)`;
      //   await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
      //   await tx.$executeRaw`SELECT set_config('app.branch_ids', ${ctx.branchIds.join(',')}, true)`;
      //   await tx.$executeRaw`SELECT set_config('app.is_global', ${ctx.isGlobal ? 'true' : 'false'}, true)`;
      // SQLite sandbox skips this — isolation is enforced via the Prisma
      // client extension in `tenantClient.ts` and via in-app filters.
      return work(tx);
    }, {
      isolationLevel,
      timeout: 30_000,
    });
  });
}

/**
 * Set the TenantContext on AsyncLocalStorage WITHOUT wrapping in a Prisma
 * transaction. Use this when the work needs to issue multiple independent
 * writes (each atomic on its own) but must NOT be serialized inside one
 * transaction — for example, the idempotency middleware writes its own row
 * and then runs the actual handler (which may itself open a transaction).
 *
 * SQLite sandbox note: SQLite uses a single-writer lock, so nested writes
 * inside a parent $transaction can deadlock. Use runInTenantContext() for
 * middleware-style flows and reserve withTenant() for true atomic units
 * of work.
 */
export async function runInTenantContext<T>(
  ctx: TenantContext,
  work: () => Promise<T>,
): Promise<T> {
  return tenantStorage.run(ctx, work);
}

/**
 * Build a TenantContext from a request. Used by the auth middleware after
 * the JWT has been verified.
 */
export function buildTenantContext(params: {
  companyId: string;
  userId?: string;
  deviceId?: string;
  branchIds: string[];
  isGlobal?: boolean;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
}): TenantContext {
  return {
    companyId: params.companyId,
    userId: params.userId,
    deviceId: params.deviceId,
    branchIds: params.branchIds,
    isGlobal: params.isGlobal ?? false,
    correlationId: params.correlationId ?? randomUUID(),
    requestId: randomUUID(),
    ip: params.ip,
    userAgent: params.userAgent,
  };
}

/**
 * Re-export the unrestricted client for system-level work (migrations,
// seeds, platform_operations cross-tenant views). Tenant-scoped code MUST
// NOT import this directly — see blueprint §6 rule 9.
 */
export const systemDb: PrismaClient = db;
