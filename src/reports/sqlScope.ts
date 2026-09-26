// src/reports/sqlScope.ts
// Tenant and branch scope for the few report aggregates Prisma cannot express.
//
// The tenant-isolation extension (src/lib/db/tenantClient.ts) scopes model
// operations only; `$queryRaw` passes through it untouched. A raw report query
// must therefore apply exactly the scope the extension would have applied:
// the company, and -- for a user limited to some branches -- the branch of
// every branch-owned row it reads. This reads that scope from the same tenant
// context and fails closed without one.
//
// Every value reaches the database as a bound parameter. Column references are
// fixed identifiers written in this repository, never request input.

import { Prisma } from '@prisma/client';
import { requireTenantContext } from '@/lib/db/transactionContext';

export interface ReportSqlScope {
  companyId: string;
  /** `AND <column> IN (...)` for a branch-limited user; nothing otherwise. */
  branch(column: string): Prisma.Sql;
}

const IDENTIFIER = /^[a-z_]+\.[a-z_]+$/;

export function reportSqlScope(companyId: string): ReportSqlScope {
  const ctx = requireTenantContext();
  if (!ctx.isGlobal && ctx.companyId !== companyId) throw new Error('TENANT_VIOLATION');
  const branchIds = ctx.isGlobal || ctx.allBranches ? null : ctx.branchIds;
  return {
    companyId,
    branch(column) {
      if (!IDENTIFIER.test(column)) throw new Error(`REPORT_SQL_COLUMN_INVALID:${column}`);
      if (branchIds === null) return Prisma.empty;
      if (branchIds.length === 0) return Prisma.sql`AND 1 = 0`;
      return Prisma.sql`AND ${Prisma.raw(column)} IN (${Prisma.join(branchIds)})`;
    },
  };
}
