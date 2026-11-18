// Expenses above the approval threshold wait for approval (disposable
// MariaDB, rolled back):
//   - below the threshold an expense posts at once, as before;
//   - above it the expense is held as pending_approval with an approval
//     request, and nothing reaches the ledger;
//   - posting it on approval writes one balanced journal from the account it
//     was entered with, and marks it posted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postExpense, postExpenseJournal } from '@/domain/commands/m4/PostExpense';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';
import { runInTenantContext } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = 'cf718293-a4b5-4c01-9234-5e6f708192a3';
const ROLLBACK = new Error('ROLLBACK_EXPENSE');
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'EX', code: 'SYN-EX' });
}, 120_000);
afterAll(() => db.$disconnect());

async function probe(body: (tx: Prisma.TransactionClient) => Promise<void>) {
  const ctx = { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, correlationId: randomUUID(), requestId: randomUUID() } as never;
  try { await runInTenantContext(ctx, () => db.$transaction(async tx => { await body(tx); throw ROLLBACK; }, { timeout: 60_000 })); }
  catch (error) { if (error !== ROLLBACK) throw error; }
}

const expenseInput = async (tx: Prisma.TransactionClient, amount: number) => {
  const category = await tx.expenseCategory.create({ data: { companyId: COMPANY_ID, name: `Rent ${randomUUID().slice(0, 6)}`, expenseAccountId: fx.expense.id, isActive: true } });
  return { companyId: COMPANY_ID, branchId: fx.branches[0].id, expenseDate: new Date(), currencyCode: 'BDT', exchangeRate: 1, description: 'Shop rent',
    financialAccountId: fx.cash.id, createdBy: fx.user.id, items: [{ expenseCategoryId: category.id, amount, taxAmount: 0 }] };
};

describe('expense approval', () => {
  it('a small expense posts at once', async () => {
    await probe(async tx => {
      const done = await postExpense(tx, await expenseInput(tx, 2500), randomUUID());
      expect(done.status).toBe('posted');
      expect(await tx.journalEntry.count({ where: { companyId: COMPANY_ID, sourceType: 'expense', sourceId: done.expenseId } })).toBe(1);
    });
  });

  it('a large expense waits for approval, then posts one balanced journal from its account', async () => {
    await probe(async tx => {
      const held = await postExpense(tx, await expenseInput(tx, 45000), randomUUID());
      expect(held.status).toBe('pending_approval');
      expect(await tx.journalEntry.count({ where: { companyId: COMPANY_ID, sourceType: 'expense', sourceId: held.expenseId } })).toBe(0);
      const expense = await tx.expense.findUniqueOrThrow({ where: { id: held.expenseId } });
      const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id: expense.approvalRequestId! } });
      expect(request.status).toBe('pending');
      expect(JSON.parse(request.payload).financial_account_id).toBe(fx.cash.id);

      await postExpenseJournal(tx, { companyId: COMPANY_ID, expenseId: held.expenseId, financialAccountId: fx.cash.id, postedBy: fx.user.id }, randomUUID());
      const lines = await tx.journalLine.findMany({ where: { companyId: COMPANY_ID, journalEntry: { sourceType: 'expense', sourceId: held.expenseId } } });
      const sum = (k: 'debitBase' | 'creditBase') => lines.reduce((t, l) => t.plus(l[k]), new Prisma.Decimal(0)).toFixed(2);
      expect(sum('debitBase')).toBe('45000.00');
      expect(sum('creditBase')).toBe('45000.00');
      expect((await tx.expense.findUniqueOrThrow({ where: { id: held.expenseId } })).status).toBe('posted');
    });
  });
});
