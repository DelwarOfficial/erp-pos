// Payroll posts and pays against each employee's own accounts (disposable
// MariaDB, rolled back):
//   - posting stores one line per employee and charges each employee's
//     expense and payable account, not the first employee's for everyone;
//   - paying clears each employee's net pay from the payable account it was
//     posted to, in exact money, and a run is paid once only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postPayrollRun } from '@/domain/commands/m6/PostPayrollRun';
import { payPayrollRun } from '@/domain/commands/m6/PayPayrollRun';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';
import { runInTenantContext } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = 'be607182-93a4-4fb0-8123-4d5e6f708192';
const ROLLBACK = new Error('ROLLBACK_PAYROLL');
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'PY', code: 'SYN-PY' });
}, 120_000);
afterAll(() => db.$disconnect());

async function probe(body: (tx: Prisma.TransactionClient) => Promise<void>) {
  const ctx = { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, correlationId: randomUUID(), requestId: randomUUID() } as never;
  try { await runInTenantContext(ctx, () => db.$transaction(async tx => { await body(tx); throw ROLLBACK; }, { timeout: 60_000 })); }
  catch (error) { if (error !== ROLLBACK) throw error; }
}

const account = (tx: Prisma.TransactionClient, code: string, accountClass: 'expense' | 'liability') => tx.chartOfAccount.create({ data: {
  companyId: COMPANY_ID, code: `${code}-${randomUUID().slice(0, 6)}`, name: code, accountClass,
  accountSubtype: accountClass === 'expense' ? 'operating_expense' : 'current_liability', normalBalance: accountClass === 'expense' ? 'D' : 'C', isActive: true } });

describe('payroll accounts', () => {
  it('posts and pays each employee against their own accounts, once', async () => {
    await probe(async tx => {
      const branch = fx.branches[0];
      const [salesExp, salesPay, svcExp, svcPay] = [await account(tx, 'salesExp', 'expense'), await account(tx, 'salesPay', 'liability'),
        await account(tx, 'svcExp', 'expense'), await account(tx, 'svcPay', 'liability')];
      const emp = (name: string, exp: string, pay: string) => tx.employee.create({ data: { companyId: COMPANY_ID, branchId: branch.id,
        employeeNo: `E-${randomUUID().slice(0, 6)}`, name, joinDate: new Date('2026-01-01'), payrollExpenseAccountId: exp, payrollPayableAccountId: pay } });
      const rahim = await emp('Rahim', salesExp.id, salesPay.id);
      const karim = await emp('Karim', svcExp.id, svcPay.id);

      const run = await postPayrollRun(tx, { companyId: COMPANY_ID, branchId: branch.id, periodStart: new Date('2026-10-01'), periodEnd: new Date('2026-10-31'),
        createdBy: fx.user.id, items: [
          { employeeId: rahim.id, baseSalary: 20000.5, allowanceTotal: 1000, deductionTotal: 500 },
          { employeeId: karim.id, baseSalary: 15000, withholdingTotal: 300.25 },
        ] }, randomUUID());
      const runId = run.payrollRunId;
      expect(await tx.payrollItem.count({ where: { payrollRunId: runId } })).toBe(2);

      const net = async (accountId: string, postingKind: string) => {
        const t = await tx.journalLine.aggregate({ where: { companyId: COMPANY_ID, chartOfAccountId: accountId, journalEntry: { sourceType: 'payroll_run', sourceId: runId, postingKind } }, _sum: { debitBase: true, creditBase: true } });
        return new Prisma.Decimal(t._sum.debitBase ?? 0).minus(t._sum.creditBase ?? 0).toFixed(2);
      };
      expect(await net(salesExp.id, 'payroll')).toBe('21000.50');
      expect(await net(svcExp.id, 'payroll')).toBe('15000.00');
      expect(await net(salesPay.id, 'payroll')).toBe('-21000.50');
      expect(await net(svcPay.id, 'payroll')).toBe('-15000.00');

      await payPayrollRun(tx, { payrollRunId: runId, companyId: COMPANY_ID, branchId: branch.id, financialAccountId: fx.cash.id, paidBy: fx.user.id }, randomUUID());
      expect(await net(salesPay.id, 'payroll_payment')).toBe('20500.50');
      expect(await net(svcPay.id, 'payroll_payment')).toBe('14699.75');

      await expect(payPayrollRun(tx, { payrollRunId: runId, companyId: COMPANY_ID, branchId: branch.id, financialAccountId: fx.cash.id, paidBy: fx.user.id }, randomUUID()))
        .rejects.toThrow(/must be posted/);
    });
  });
});
