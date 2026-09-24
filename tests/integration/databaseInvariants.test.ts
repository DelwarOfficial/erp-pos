// F-25 / F-26 regression: two invariants that lived only in application code,
// or only on the PostgreSQL target, must be rejected by the production
// database itself.
//
//   F-25  qty_on_hand >= 0 and qty_reserved <= qty_on_hand existed in
//         prisma/migrations/0010 (PostgreSQL) and not in the MariaDB set, so
//         the only guard in production was stockMovement.ts -- while the
//         go-live checklist recorded the CHECK as "verified".
//   F-26  nothing checked that a journal entry balances. 56 triggers enforced
//         immutability and tenant consistency; none of them this.
//
// Every assertion here writes raw SQL, deliberately bypassing the application,
// because the point is what the database does when the application is not the
// one writing.
import { afterAll, beforeAll, expect, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const COMPANY_ID = '7a2c9d40-5e61-4b72-9c83-1d4e5f6a7b8c';
const ROLLBACK = new Error('ROLLBACK_DB_INVARIANT_PROBE');

let fixture: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let accountId: string;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318'
    || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fixture = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'INV', code: 'SYN-INV' });
  const policy = await db.accountingPolicy.findUniqueOrThrow({ where: { companyId: COMPANY_ID } });
  accountId = policy.inventoryAccountId;
});

afterAll(() => db.$disconnect());

async function probe(body: (tx: PrismaClient) => Promise<void>): Promise<void> {
  try {
    await db.$transaction(async tx => {
      await body(tx as unknown as PrismaClient);
      throw ROLLBACK;
    }, { timeout: 30000 });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

/** Runs a statement and returns the database's error message, or null if it succeeded. */
async function rejection(tx: PrismaClient, sql: string): Promise<string | null> {
  try {
    await tx.$executeRawUnsafe(sql);
    return null;
  } catch (error) {
    return String(error);
  }
}

describe('F-25: the database refuses negative stock', () => {
  it('rejects a direct INSERT with negative qty_on_hand', async () => {
    await probe(async tx => {
      const warehouse = await tx.warehouse.findFirstOrThrow({ where: { companyId: COMPANY_ID } })
        .catch(async () => tx.warehouse.create({
          data: {
            companyId: COMPANY_ID, branchId: fixture.branches[0].id,
            code: 'WH-INV', name: 'Invariant probe warehouse', isActive: true,
          },
        }));
      let unit = await tx.unit.findFirst({ where: { companyId: COMPANY_ID } });
      if (!unit) unit = await tx.unit.create({ data: { companyId: COMPANY_ID, code: 'pc', name: 'Piece' } });
      let category = await tx.category.findFirst({ where: { companyId: COMPANY_ID } });
      if (!category) category = await tx.category.create({ data: { companyId: COMPANY_ID, code: 'gen', name: 'General' } });
      const product = await tx.product.create({
        data: {
          companyId: COMPANY_ID, code: `INV-${randomUUID().slice(0, 8)}`, name: 'Invariant probe',
          productType: 'standard', unitId: unit.id, categoryId: category.id,
          defaultPrice: 10, referenceCost: 5, isActive: true,
        },
      });

      const error = await rejection(tx, `
        INSERT INTO warehouse_stocks
          (id, company_id, warehouse_id, product_id, qty_on_hand, qty_reserved,
           qty_in_transit_out, qty_damaged, moving_average_cost, version, updated_at)
        VALUES
          ('${randomUUID()}', '${COMPANY_ID}', '${warehouse.id}', '${product.id}',
           -1, 0, 0, 0, 5, 0, NOW())
      `);

      // Before this migration MariaDB accepted the row: the constraint existed
      // only in the PostgreSQL migration set.
      expect(error, 'negative qty_on_hand was accepted').not.toBeNull();
      expect(error).toMatch(/CONSTRAINT|CHECK/i);
    });
  });

  it('rejects reserving more than is on hand', async () => {
    await probe(async tx => {
      const stock = await tx.warehouseStock.findFirst({
        where: { companyId: COMPANY_ID },
        select: { id: true, qtyOnHand: true },
      });
      if (!stock) return; // nothing provisioned yet; the INSERT case covers the rule

      const error = await rejection(tx,
        `UPDATE warehouse_stocks SET qty_reserved = qty_on_hand + 1 WHERE id = '${stock.id}'`);
      expect(error, 'reserving beyond on-hand was accepted').not.toBeNull();
    });
  });
});

describe('F-26: the database refuses an unbalanced journal entry', () => {
  async function insertEntry(tx: PrismaClient, params: {
    totalDebit: string; totalCredit: string; lineCount: number;
  }): Promise<string> {
    const entryId = randomUUID();
    const eventId = randomUUID();
    await tx.$executeRawUnsafe(`
      INSERT INTO business_events (id, company_id, event_type, source_type, source_id, correlation_id, occurred_at)
      VALUES ('${eventId}', '${COMPANY_ID}', 'journal_entry.posted', 'probe', '${entryId}', '${randomUUID()}', NOW())
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO journal_entries
        (id, company_id, entry_no, event_id, posting_kind, entry_date, posting_date,
         source_type, source_id, currency_code, exchange_rate, description, status,
         total_debit, total_credit, line_count, created_by, created_at)
      VALUES
        ('${entryId}', '${COMPANY_ID}', 'JE-${entryId.slice(0, 8)}', '${eventId}', 'probe',
         NOW(), NOW(), 'probe', '${entryId}', 'BDT', 1, 'Invariant probe', 'posted',
         ${params.totalDebit}, ${params.totalCredit}, ${params.lineCount}, '${fixture.user.id}', NOW())
    `);
    return entryId;
  }

  function lineSql(entryId: string, lineNo: number, debit: string, credit: string): string {
    return `
      INSERT INTO journal_lines
        (id, company_id, journal_entry_id, line_no, chart_of_account_id, debit_base, credit_base)
      VALUES
        ('${randomUUID()}', '${COMPANY_ID}', '${entryId}', ${lineNo}, '${accountId}', ${debit}, ${credit})
    `;
  }

  it('rejects a header whose declared totals do not balance', async () => {
    await probe(async tx => {
      const error = await rejection(tx, `
        INSERT INTO journal_entries
          (id, company_id, entry_no, event_id, posting_kind, entry_date, posting_date,
           source_type, source_id, currency_code, exchange_rate, description, status,
           total_debit, total_credit, line_count, created_by, created_at)
        VALUES
          ('${randomUUID()}', '${COMPANY_ID}', 'JE-BAD', '${randomUUID()}', 'probe',
           NOW(), NOW(), 'probe', 'probe', 'BDT', 1, 'Unbalanced header', 'posted',
           100, 90, 2, '${fixture.user.id}', NOW())
      `);
      expect(error, 'an unbalanced header was accepted').not.toBeNull();
      expect(error).toMatch(/journal_entries_balanced_chk|CONSTRAINT/i);
    });
  });

  it('rejects lines that do not sum to the declaration', async () => {
    await probe(async tx => {
      const entryId = await insertEntry(tx, { totalDebit: '100', totalCredit: '100', lineCount: 2 });
      // First line is fine on its own: the entry is not complete yet.
      expect(await rejection(tx, lineSql(entryId, 1, '100', '0'))).toBeNull();
      // The second completes the declared count, and 100 debit vs 90 credit
      // does not match what the header promised.
      const error = await rejection(tx, lineSql(entryId, 2, '0', '90'));
      expect(error, 'unbalanced lines were accepted').not.toBeNull();
      expect(error).toMatch(/JOURNAL_ENTRY_UNBALANCED/);
    });
  });

  it('rejects a line that pushes the entry past its declared totals', async () => {
    await probe(async tx => {
      const entryId = await insertEntry(tx, { totalDebit: '100', totalCredit: '100', lineCount: 2 });
      const error = await rejection(tx, lineSql(entryId, 1, '150', '0'));
      expect(error, 'a line exceeding the declared total was accepted').not.toBeNull();
      expect(error).toMatch(/JOURNAL_ENTRY_EXCEEDS_DECLARED_TOTALS/);
    });
  });

  it('accepts a balanced entry that matches its declaration', async () => {
    await probe(async tx => {
      const entryId = await insertEntry(tx, { totalDebit: '100', totalCredit: '100', lineCount: 2 });
      expect(await rejection(tx, lineSql(entryId, 1, '100', '0'))).toBeNull();
      expect(await rejection(tx, lineSql(entryId, 2, '0', '100'))).toBeNull();

      const lines = await tx.journalLine.aggregate({
        where: { journalEntryId: entryId },
        _sum: { debitBase: true, creditBase: true },
      });
      expect(lines._sum.debitBase?.toFixed(2)).toBe('100.00');
      expect(lines._sum.creditBase?.toFixed(2)).toBe('100.00');
    });
  });
});
