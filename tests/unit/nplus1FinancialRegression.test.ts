import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/numbering', () => ({
  nextDocumentNumber: vi.fn(async () => ({ documentNumber: 'SAFE-PROOF', sequenceValue: 1 })),
}));
vi.mock('@/domain/commands/m4/PostJournalEntry', () => ({
  postJournalEntry: vi.fn(async () => ({ journalEntryId: 'journal-safe', entryNo: 'JE-SAFE' })),
}));

import { postExpense } from '@/domain/commands/m4/PostExpense';
import { postPayrollRun } from '@/domain/commands/m6/PostPayrollRun';

describe('financial workflow N+1 regression', () => {
  for (const size of [1, 10, 100]) {
    it(`measures payroll employee reads for N=${size}`, async () => {
      const employeeRead = vi.fn(async ({ where }: any) => where.id.in.map((id: string) => ({
        id,
        name: 'Safe Employee',
        bankAccountNo: null,
        bankCode: null,
        bankBranchCode: null,
        employeeNo: 'SAFE',
        payrollExpenseAccountId: 'expense-account',
        payrollPayableAccountId: 'payable-account',
      })));
      const tx = {
        payrollRun: { create: vi.fn(async () => ({ id: 'payroll-safe' })) },
        employee: { findMany: employeeRead },
        company: { findUnique: vi.fn(async () => ({ legalName: 'Safe Company' })) },
        businessEvent: { create: vi.fn(async () => ({})) },
        auditLog: { create: vi.fn(async () => ({})) },
      } as any;
      await postPayrollRun(tx, {
        companyId: 'tenant-a',
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-01-31T00:00:00Z'),
        createdBy: 'user-a',
        items: Array.from({ length: size }, (_, i) => ({ employeeId: `employee-${i}`, baseSalary: 100 })),
      }, 'safe-proof');
      console.info('PHASE_A_PAYROLL_EMPLOYEE_READS', { size, reads: employeeRead.mock.calls.length });
      expect(employeeRead).toHaveBeenCalledTimes(1);
      expect(employeeRead.mock.calls[0][0].where.companyId).toBe('tenant-a');
    });

    it(`measures expense-category reads for N=${size}`, async () => {
      const categoryRead = vi.fn(async ({ where }: any) => where.id.in.map((id: string) => ({
        id,
        expenseAccountId: `account-${id}`,
      })));
      const tx = {
        expense: { create: vi.fn(async () => ({ id: 'expense-safe' })), update: vi.fn(async () => ({})) },
        expenseCategory: { findMany: categoryRead },
        expenseItem: { create: vi.fn(async () => ({})) },
        financialAccount: { findFirst: vi.fn(async () => ({ chartOfAccountId: 'cash-account' })) },
        auditLog: { create: vi.fn(async () => ({})) },
      } as any;
      await postExpense(tx, {
        companyId: 'tenant-a',
        branchId: 'branch-a',
        expenseDate: new Date('2026-01-01T00:00:00Z'),
        currencyCode: 'BDT',
        exchangeRate: 1,
        description: 'safe proof',
        financialAccountId: 'financial-account-a',
        createdBy: 'user-a',
        items: Array.from({ length: size }, (_, i) => ({ expenseCategoryId: `category-${i}`, amount: 1, taxAmount: 0 })),
      }, 'safe-proof');
      console.info('PHASE_A_EXPENSE_CATEGORY_READS', { size, reads: categoryRead.mock.calls.length });
      expect(categoryRead).toHaveBeenCalledTimes(1);
      expect(categoryRead.mock.calls[0][0].where.companyId).toBe('tenant-a');
    });
  }
});
