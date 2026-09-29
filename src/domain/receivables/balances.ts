// What a customer owes, per installment, from the authoritative records.
//
// Nothing here is stored. An installment's outstanding amount is derived from
//
//   installments.amount
//   - installment_allocations whose payment is still posted   (collections;
//                                                              a reversed
//                                                              payment stops
//                                                              counting, so the
//                                                              installment
//                                                              reopens)
//
// and then capped by what the sale as a whole still owes, computed the way AR
// aging computes it (src/reports/index.ts receivableSql):
//
//   grand_total - allocations of posted payments - posted return credits
//   + refunds paid against those returns
//
// Credits that reach the sale without passing through an installment -- a
// return, an applied advance -- therefore still lower the installments; they
// are taken off the oldest outstanding installment first, the same order
// collections are applied in. A sale that is no longer completed (voided,
// fully returned) owes nothing.
//
// Tenant scope is explicit: raw SQL does not pass through the tenant
// extension (src/reports/sqlScope.ts).

import { Prisma } from '@prisma/client';
import { reportSqlScope } from '@/reports/sqlScope';

export const OPEN_SALE_STATUSES = ['completed', 'partially_returned'] as const;

export interface InstallmentBalance {
  installmentId: string;
  saleId: string;
  saleReferenceNo: string;
  customerId: string | null;
  branchId: string;
  installmentNo: number;
  dueDate: Date;
  amount: Prisma.Decimal;
  collected: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  remindersEnabled: boolean;
}

type Client = { $queryRaw: Prisma.TransactionClient['$queryRaw'] };

interface Row {
  installment_id: string; sale_id: string; reference_no: string; customer_id: string | null; branch_id: string;
  installment_no: number; due_date: Date; amount: Prisma.Decimal; collected: Prisma.Decimal | null;
  sale_status: string; reminders: number | boolean;
}

/**
 * Scheduled installments with their outstanding amounts, oldest due first.
 * Select by customer, sales or installments; the caller bounds the set.
 */
export async function installmentBalances(
  client: Client,
  companyId: string,
  by: { customerId?: string; saleIds?: string[]; installmentIds?: string[] },
): Promise<InstallmentBalance[]> {
  const scope = reportSqlScope(companyId);
  const filters: Prisma.Sql[] = [];
  if (by.customerId) filters.push(Prisma.sql`AND s.customer_id = ${by.customerId}`);
  if (by.saleIds) filters.push(by.saleIds.length ? Prisma.sql`AND s.id IN (${Prisma.join(by.saleIds)})` : Prisma.sql`AND 1 = 0`);
  if (by.installmentIds) filters.push(by.installmentIds.length ? Prisma.sql`AND i.id IN (${Prisma.join(by.installmentIds)})` : Prisma.sql`AND 1 = 0`);

  const rows = await client.$queryRaw<Row[]>`
    SELECT i.id AS installment_id, s.id AS sale_id, s.reference_no, s.customer_id, s.branch_id,
           i.installment_no, i.due_date, i.amount, s.sale_status, s.due_reminders_enabled AS reminders,
           (SELECT SUM(ia.allocated_amount)
              FROM installment_allocations ia
              JOIN payment_allocations pa ON pa.id = ia.payment_allocation_id AND pa.company_id = ia.company_id
              JOIN payments p ON p.id = pa.payment_id AND p.company_id = pa.company_id
             WHERE ia.installment_id = i.id AND ia.company_id = i.company_id AND p.payment_status = 'posted') AS collected
    FROM installments i
    JOIN sales s ON s.id = i.sale_id AND s.company_id = i.company_id
    WHERE i.company_id = ${scope.companyId} AND i.status = 'scheduled'
      ${filters.length ? Prisma.join(filters, ' ') : Prisma.empty}
      ${scope.branch('s.branch_id')}
    ORDER BY i.due_date, s.business_date, s.id, i.installment_no`;
  if (rows.length === 0) return [];

  const saleIds = [...new Set(rows.map(r => r.sale_id))];
  const owed = await saleOutstanding(client, scope.companyId, saleIds);

  // Per sale, installments net of their own collections, oldest first; any
  // amount above what the sale still owes comes off the oldest.
  const balances: InstallmentBalance[] = rows.map(r => {
    const amount = new Prisma.Decimal(r.amount);
    const collected = new Prisma.Decimal(r.collected ?? 0);
    const open = OPEN_SALE_STATUSES.includes(r.sale_status as never);
    return {
      installmentId: r.installment_id, saleId: r.sale_id, saleReferenceNo: r.reference_no, customerId: r.customer_id,
      branchId: r.branch_id, installmentNo: Number(r.installment_no), dueDate: r.due_date, amount, collected,
      outstanding: open ? Prisma.Decimal.max(amount.minus(collected), 0) : new Prisma.Decimal(0),
      remindersEnabled: Boolean(Number(r.reminders)),
    };
  });
  for (const saleId of saleIds) {
    const ofSale = balances.filter(b => b.saleId === saleId);
    const scheduled = ofSale.reduce((sum, b) => sum.plus(b.outstanding), new Prisma.Decimal(0));
    let excess = scheduled.minus(Prisma.Decimal.max(owed.get(saleId) ?? 0, 0));
    for (const b of ofSale) {
      if (excess.lte(0)) break;
      const cut = Prisma.Decimal.min(excess, b.outstanding);
      b.outstanding = b.outstanding.minus(cut);
      excess = excess.minus(cut);
    }
  }
  return balances;
}

/** What each sale still owes as a whole (the AR aging formula). */
async function saleOutstanding(client: Client, companyId: string, saleIds: string[]) {
  const rows = await client.$queryRaw<Array<{ sale_id: string; owed: Prisma.Decimal }>>`
    SELECT s.id AS sale_id,
           s.grand_total
           - COALESCE((SELECT SUM(a.allocated_amount) FROM payment_allocations a
                         JOIN payments p ON p.id = a.payment_id AND p.company_id = a.company_id
                        WHERE a.sale_id = s.id AND a.company_id = s.company_id AND p.payment_status = 'posted'), 0)
           - COALESCE((SELECT SUM(r.total_credit) FROM sale_returns r
                        WHERE r.sale_id = s.id AND r.company_id = s.company_id AND r.status = 'posted'), 0)
           + COALESCE((SELECT SUM(p.amount) FROM payments p
                         JOIN sale_returns r ON r.id = p.sale_return_id AND r.company_id = p.company_id
                        WHERE r.sale_id = s.id AND p.company_id = s.company_id AND r.status = 'posted'
                          AND p.payment_type = 'sale_refund' AND p.direction = 'outgoing' AND p.payment_status = 'posted'), 0) AS owed
    FROM sales s
    WHERE s.company_id = ${companyId} AND s.id IN (${Prisma.join(saleIds)})`;
  return new Map(rows.map(r => [r.sale_id, new Prisma.Decimal(r.owed)]));
}

/**
 * The same balances for a whole company in one query, for dashboards and
 * worklists where loading every installment into memory would not scale.
 * Produces a CTE `bal`, one row per scheduled installment of an open sale:
 *
 *   installment_id, sale_id, reference_no, customer_id, branch_id, biller_id,
 *   phone_snapshot, reminders_enabled, installment_no, due_date, amount,
 *   collected, outstanding
 *
 * `outstanding` follows installmentBalances() exactly: amount less collections
 * by posted payments, then any excess over what the sale still owes taken off
 * the oldest installments first (window sums over the sale's installments in
 * due-date order). tests/integration/collectionsOverview.test.ts checks the
 * two agree.
 */
export function openInstallmentsCte(companyId: string): Prisma.Sql {
  const scope = reportSqlScope(companyId);
  return Prisma.sql`
    WITH inst AS (
      SELECT i.id AS installment_id, i.sale_id, s.reference_no, s.customer_id, s.branch_id, s.biller_id,
             s.customer_phone_snapshot AS phone_snapshot, s.due_reminders_enabled AS reminders_enabled,
             i.installment_no, i.due_date, i.amount, s.business_date,
             COALESCE((SELECT SUM(ia.allocated_amount)
                         FROM installment_allocations ia
                         JOIN payment_allocations pa ON pa.id = ia.payment_allocation_id AND pa.company_id = ia.company_id
                         JOIN payments p ON p.id = pa.payment_id AND p.company_id = pa.company_id
                        WHERE ia.installment_id = i.id AND ia.company_id = i.company_id AND p.payment_status = 'posted'), 0) AS collected
      FROM installments i
      JOIN sales s ON s.id = i.sale_id AND s.company_id = i.company_id
      WHERE i.company_id = ${scope.companyId} AND i.status = 'scheduled'
        AND s.sale_status IN (${Prisma.join([...OPEN_SALE_STATUSES])})
        ${scope.branch('s.branch_id')}
    ), owed AS (
      SELECT s.id AS sale_id,
             s.grand_total
             - COALESCE((SELECT SUM(a.allocated_amount) FROM payment_allocations a
                           JOIN payments p ON p.id = a.payment_id AND p.company_id = a.company_id
                          WHERE a.sale_id = s.id AND a.company_id = s.company_id AND p.payment_status = 'posted'), 0)
             - COALESCE((SELECT SUM(r.total_credit) FROM sale_returns r
                          WHERE r.sale_id = s.id AND r.company_id = s.company_id AND r.status = 'posted'), 0)
             + COALESCE((SELECT SUM(p.amount) FROM payments p
                           JOIN sale_returns r ON r.id = p.sale_return_id AND r.company_id = p.company_id
                          WHERE r.sale_id = s.id AND p.company_id = s.company_id AND r.status = 'posted'
                            AND p.payment_type = 'sale_refund' AND p.direction = 'outgoing' AND p.payment_status = 'posted'), 0) AS owed
      FROM sales s
      WHERE s.company_id = ${scope.companyId} AND s.id IN (SELECT DISTINCT sale_id FROM inst)
    ), rem AS (
      SELECT inst.*, GREATEST(inst.amount - inst.collected, 0) AS remaining FROM inst
    ), capped AS (
      SELECT rem.*,
             GREATEST(SUM(rem.remaining) OVER (PARTITION BY rem.sale_id) - GREATEST(owed.owed, 0), 0) AS excess,
             COALESCE(SUM(rem.remaining) OVER (PARTITION BY rem.sale_id ORDER BY rem.due_date, rem.installment_no
                                                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before_remaining
      FROM rem JOIN owed ON owed.sale_id = rem.sale_id
    ), bal AS (
      SELECT installment_id, sale_id, reference_no, customer_id, branch_id, biller_id, phone_snapshot, reminders_enabled,
             installment_no, due_date, amount, collected, business_date,
             GREATEST(remaining - GREATEST(excess - before_remaining, 0), 0) AS outstanding
      FROM capped
    )`;
}
