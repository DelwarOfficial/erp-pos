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

import { DomainError } from '@/lib/errors/codes';
import { PrismaClient, Prisma } from '@prisma/client';
export type TransactionClient = Prisma.TransactionClient;
import { randomUUID } from 'node:crypto';
import { db, systemDb } from './index';
import { tenantStorage } from './transactionContext';
import type { TenantContext } from './transactionContext';
export type { TenantContext } from './transactionContext';
export { getTenantContext, requireTenantContext } from './transactionContext';

export type UnitOfWork<T> = (tx: TransactionClient) => Promise<T>;

/**
 * MariaDB aborts one of two conflicting transactions: a deadlock (1213), or
 * "record has changed since last read" (1020) under SERIALIZABLE. Prisma
 * reports P2034 when it recognises it.
 */
export function isWriteConflict(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  return e?.code === 'P2034' || /deadlock|1213|write conflict|could not serialize|1020|Record has changed since last read/i.test(String(e?.message ?? ''));
}

/** Attempts in all, for a unit of work aborted by a write conflict (F-35). */
export const WRITE_CONFLICT_ATTEMPTS = 3;

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
  // timeout: only for a unit of work measured to need longer, and say why there.
  options?: { isolationLevel?: 'Serializable' | 'ReadCommitted'; timeout?: number },
): Promise<T> {
  // F-35: every unit of work runs SERIALIZABLE, so under contention MariaDB
  // aborts one side. The whole transaction rolled back, so it is run again
  // (after a short random pause), up to WRITE_CONFLICT_ATTEMPTS times. Units
  // of work only touch the database -- provider calls happen outside
  // transactions -- so a rerun repeats nothing external. A conflict that
  // persists is reported as a retryable 409, not a 500.
  for (let attempt = 1; ; attempt++) {
    try {
      return await runOnce(ctx, work, options);
    } catch (error) {
      if (!isWriteConflict(error)) throw error;
      if (attempt >= WRITE_CONFLICT_ATTEMPTS) {
        throw new DomainError('CONCURRENT_MODIFICATION', 'The data was changed by another request at the same moment. Please retry.', {}, 409);
      }
      await new Promise(resolve => setTimeout(resolve, 20 + Math.floor(Math.random() * 60) * attempt));
    }
  }
}

async function runOnce<T>(
  ctx: TenantContext,
  work: UnitOfWork<T>,
  options?: { isolationLevel?: 'Serializable' | 'ReadCommitted'; timeout?: number },
): Promise<T> {
  return tenantStorage.run(ctx, async (): Promise<T> => {
    // SQLite only supports Serializable; ReadCommitted is ignored.
    // In PostgreSQL production, the isolation level would be passed through.
    const result: T = await db.$transaction(async (tx) => {
      // In Postgres production we would execute:
      //   await tx.$executeRaw`SELECT set_config('app.company_id', ${ctx.companyId}, true)`;
      //   await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
      //   await tx.$executeRaw`SELECT set_config('app.branch_ids', ${ctx.branchIds.join(',')}, true)`;
      //   await tx.$executeRaw`SELECT set_config('app.is_global', ${ctx.isGlobal ? 'true' : 'false'}, true)`;
      // SQLite sandbox skips this — isolation is enforced via the Prisma
      // client extension in `tenantClient.ts` and via in-app filters.
      return tenantStorage.run({ ...ctx, transactionClient: tx }, async () => await work(tx));
    }, {
      isolationLevel: 'Serializable',
      timeout: options?.timeout ?? 30_000,
    }) as T;
    return result;
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
  // Prisma executes client-extension hooks lazily when the returned promise
  // is first awaited — NOT when the query method is called. Therefore `work`
  // MUST be an `async` function that awaits tenant-scoped queries inside its
  // body (or chains them before returning). A sync arrow that merely returns
  // a bare PrismaPromise (e.g. `() => db.user.findFirst(...)`) lets the hook
  // fire after run() has exited, losing the context (fail-closed throw).
  // Await inside the scope: PrismaPromise is lazy, so even a caller returning
  // a bare query must execute its extension hooks before leaving this context.
  return tenantStorage.run(ctx, async () => await work());
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
  allBranches?: boolean;
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
    allBranches: params.allBranches ?? false,
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
export { systemDb };
