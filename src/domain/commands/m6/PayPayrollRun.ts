// src/domain/commands/m6/PayPayrollRun.ts
// PayPayrollRun per §7.17 — marks payroll as paid + posts payment journal.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

export interface PayPayrollRunInput {
  payrollRunId: string;
  companyId: string;
  branchId: string;
  financialAccountId: string;
  paidBy: string;
}

export async function payPayrollRun(
  tx: Prisma.TransactionClient, input: PayPayrollRunInput, correlationId: string,
): Promise<{ payrollRunId: string; status: string; paymentRef: string }> {
  // One payment per run, even if two requests arrive together.
  await tx.$queryRaw`SELECT id FROM payroll_runs WHERE id = ${input.payrollRunId} AND company_id = ${input.companyId} FOR UPDATE`;
  const run = await tx.payrollRun.findFirst({
    where: { id: input.payrollRunId, companyId: input.companyId },
  });
  if (!run) throw new DomainError('RESOURCE_NOT_FOUND', 'Payroll run not found', {}, 404);
  if (run.status !== 'posted') {
    throw new DomainError('VALIDATION_FAILED', `Payroll must be posted to pay (current: ${run.status})`, {}, 409);
  }

  const { documentNumber: refNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId, branchId: input.branchId,
    documentType: 'PAYROLL_PAYMENT', fiscalYear: new Date().getFullYear(), prefix: 'PR-PAY-',
  });

  const fa = await tx.financialAccount.findFirst({
    where: { id: input.financialAccountId, companyId: input.companyId }, include: { chartOfAccount: true },
  });
  if (!fa) throw new DomainError('VALIDATION_FAILED', 'Financial account not found', {}, 404);

  if (fa.branchId && fa.branchId !== input.branchId) throw new DomainError('VALIDATION_FAILED', 'That account belongs to another branch', {}, 400);

  // Clear each employee's net pay from the payable account it was posted to.
  // This used to debit the payable account of whichever employee the database
  // returned first -- possibly not one in this run at all.
  const items = await tx.payrollItem.findMany({ where: { companyId: input.companyId, payrollRunId: run.id }, select: { netPay: true, employeeId: true } });
  if (!items.length) throw new DomainError('VALIDATION_FAILED', 'This payroll run has no employees', {}, 409);
  const employees = await tx.employee.findMany({ where: { companyId: input.companyId, id: { in: [...new Set(items.map(i => i.employeeId))] } }, select: { id: true, payrollPayableAccountId: true } });
  const payableOf = new Map(employees.map(e => [e.id, e.payrollPayableAccountId]));
  const byAccount = new Map<string, Prisma.Decimal>();
  for (const item of items) {
    const account = payableOf.get(item.employeeId);
    if (!account) throw new DomainError('VALIDATION_FAILED', 'An employee in this run no longer exists', { employee_id: item.employeeId }, 409);
    byAccount.set(account, (byAccount.get(account) ?? new Prisma.Decimal(0)).plus(item.netPay));
  }
  const netTotal = [...byAccount.values()].reduce((t, v) => t.plus(v), new Prisma.Decimal(0)).toDecimalPlaces(2);

  // Dr Payroll Payable (per account), Cr Cash/Bank
  await postJournalEntry(tx, {
    companyId: input.companyId, entryDate: new Date(),
    // The run's posting already holds (payroll_run, run.id) as its event key;
    // the payment needs its own, or every payment failed on that unique key.
    postingKind: 'payroll_payment', sourceType: 'payroll_run', sourceId: run.id, eventSourceId: `${run.id}:payment`,
    description: `Payroll payment ${refNo} for ${run.referenceNo}`,
    currencyCode: 'BDT', exchangeRate: 1, createdBy: input.paidBy,
    lines: [
      ...[...byAccount].map(([chartOfAccountId, amount]) => ({ chartOfAccountId, branchId: input.branchId, debit: amount.toDecimalPlaces(2), credit: 0, memo: `Payroll payable cleared ${run.referenceNo}` })),
      { chartOfAccountId: fa.chartOfAccountId, financialAccountId: fa.id, branchId: input.branchId, debit: 0, credit: netTotal, memo: `Cash/bank paid ${refNo}` },
    ],
  }, correlationId);

  await tx.payrollRun.update({
    where: { id: run.id }, data: { status: 'paid' },
  });

  await tx.auditLog.create({
    data: { companyId: input.companyId, userId: input.paidBy, correlationId,
      action: 'payroll_run.pay', entityType: 'payroll_run', entityId: run.id,
      afterValue: JSON.stringify({ status: 'paid', net_paid: netTotal.toFixed(2), ref: refNo }) },
  });

  return { payrollRunId: run.id, status: 'paid', paymentRef: refNo };
}
