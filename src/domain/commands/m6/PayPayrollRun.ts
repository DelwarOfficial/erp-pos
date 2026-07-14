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

  // Find the payroll payable account (from first employee)
  const firstEmp = await tx.employee.findFirst({ where: { companyId: input.companyId } });
  if (!firstEmp) throw new DomainError('VALIDATION_FAILED', 'No employees found', {}, 400);

  const netTotal = parseFloat(run.netTotal.toString());

  // Dr Payroll Payable, Cr Cash/Bank
  await postJournalEntry(tx, {
    companyId: input.companyId, entryDate: new Date(),
    postingKind: 'payroll_payment', sourceType: 'payroll_run', sourceId: run.id,
    description: `Payroll payment ${refNo} for ${run.referenceNo}`,
    currencyCode: 'BDT', exchangeRate: 1, createdBy: input.paidBy,
    lines: [
      { chartOfAccountId: firstEmp.payrollPayableAccountId, debit: netTotal, credit: 0, memo: `Payroll payable cleared ${run.referenceNo}` },
      { chartOfAccountId: fa.chartOfAccountId, debit: 0, credit: netTotal, memo: `Cash/bank paid ${refNo}` },
    ],
  }, correlationId);

  await tx.payrollRun.update({
    where: { id: run.id }, data: { status: 'paid' },
  });

  await tx.auditLog.create({
    data: { companyId: input.companyId, userId: input.paidBy, correlationId,
      action: 'payroll_run.pay', entityType: 'payroll_run', entityId: run.id,
      afterValue: JSON.stringify({ status: 'paid', net_paid: netTotal, ref: refNo }) },
  });

  return { payrollRunId: run.id, status: 'paid', paymentRef: refNo };
}
