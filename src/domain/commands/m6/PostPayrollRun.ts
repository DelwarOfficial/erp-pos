// src/domain/commands/m6/PostPayrollRun.ts
// PostPayrollRun per §7.17 + §20.D18.
// Posts payroll with journal (Dr Salaries, Cr Payroll Payable) + BEFTN bank file stub.
// Segregation of duties: creator cannot approve own run (enforced at API level).

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

export interface PayrollItemInput {
  employeeId: string;
  baseSalary: number;
  allowanceTotal?: number;
  overtimeTotal?: number;
  deductionTotal?: number;
  withholdingTotal?: number;
}

export interface PostPayrollRunInput {
  companyId: string;
  branchId?: string;
  periodStart: Date;
  periodEnd: Date;
  createdBy: string;
  items: PayrollItemInput[];
}

export async function postPayrollRun(
  tx: Prisma.TransactionClient,
  input: PostPayrollRunInput,
  correlationId: string,
): Promise<{
  payrollRunId: string;
  referenceNo: string;
  status: string;
  grossTotal: string;
  deductionTotal: string;
  netTotal: string;
  journalEntryNo: string;
  beftnFile: string;
}> {
  if (input.items.length === 0) {
    throw new DomainError('VALIDATION_FAILED', 'Payroll run requires at least 1 employee', {}, 400);
  }
  if (input.periodEnd < input.periodStart) {
    throw new DomainError('VALIDATION_FAILED', 'period_end must be >= period_start', {}, 400);
  }

  let grossTotal = 0;
  let deductionTotal = 0;
  let netTotal = 0;

  for (const item of input.items) {
    const gross = item.baseSalary + (item.allowanceTotal ?? 0) + (item.overtimeTotal ?? 0);
    const deductions = (item.deductionTotal ?? 0) + (item.withholdingTotal ?? 0);
    const net = gross - deductions;
    if (net < 0) {
      throw new DomainError('VALIDATION_FAILED', `Net pay cannot be negative for employee ${item.employeeId}`, {}, 400);
    }
    grossTotal += gross;
    deductionTotal += deductions;
    netTotal += net;
  }

  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId, branchId: input.branchId,
    documentType: 'PAYROLL', fiscalYear: input.periodStart.getFullYear(), prefix: 'PR-',
  });

  const run = await tx.payrollRun.create({
    data: {
      companyId: input.companyId, branchId: input.branchId ?? null,
      referenceNo, periodStart: input.periodStart, periodEnd: input.periodEnd,
      status: 'posted', grossTotal, deductionTotal, netTotal,
      postedAt: new Date(), createdBy: input.createdBy,
    },
  });

  // Build BEFTN bank file using the real BEFTN generator (§20.D18)
  const { generateBEFTNFile } = await import('@/lib/payroll/beftn');
  type BEFTNEntry = import('@/lib/payroll/beftn').BEFTNEntry;
  type BEFTNFileOptions = import('@/lib/payroll/beftn').BEFTNFileOptions;

  const beftnEntries: BEFTNEntry[] = [];
  const employeeData: Array<{ employeeId: string; net: number }> = [];

  // Validate employees + build BEFTN entries
  for (const item of input.items) {
    const employee = await tx.employee.findFirst({
      where: { id: item.employeeId, companyId: input.companyId, employmentStatus: 'active' },
    });
    if (!employee) {
      throw new DomainError('VALIDATION_FAILED', `Employee ${item.employeeId} not found or inactive`, {}, 404);
    }
    const gross = item.baseSalary + (item.allowanceTotal ?? 0) + (item.overtimeTotal ?? 0);
    const deductions = (item.deductionTotal ?? 0) + (item.withholdingTotal ?? 0);
    const net = gross - deductions;

    employeeData.push({ employeeId: employee.id, net });

    beftnEntries.push({
      serialNo: beftnEntries.length + 1,
      beneficiaryName: employee.name,
      beneficiaryAccount: employee.bankAccountNo ?? '00000000000000000',
      bankCode: employee.bankCode ?? '000',
      branchCode: employee.bankBranchCode ?? '0000',
      amount: net,
      accountType: 'salary',
      referenceNo: employee.employeeNo,
      purpose: 'Salary',
    });
  }

  const beftnOptions: BEFTNFileOptions = {
    senderName: (await tx.company.findUnique({ where: { id: input.companyId }, select: { legalName: true } }))?.legalName ?? 'ERP POS',
    senderAccount: '00000000000000000',
    senderBankCode: '000',
    senderBranchCode: '0000',
    fileReferenceNo: referenceNo,
    valueDate: new Date().toISOString().split('T')[0],
    currency: 'BDT',
  };

  const beftnFile = generateBEFTNFile(beftnEntries, beftnOptions);

  // Post journal: Dr Salaries Expense, Cr Deductions, Cr Payroll Payable (net)
  let journalEntryNo = '';
  const firstEmp = await tx.employee.findFirst({
    where: { id: input.items[0].employeeId, companyId: input.companyId },
  });

  if (firstEmp) {
    const journalLines = [
      {
        chartOfAccountId: firstEmp.payrollExpenseAccountId,
        debit: grossTotal, credit: 0,
        memo: `Payroll: ${referenceNo} — ${input.items.length} employees`,
        branchId: input.branchId,
      },
    ];
    if (deductionTotal > 0) {
      journalLines.push({
        chartOfAccountId: firstEmp.payrollPayableAccountId,
        debit: 0, credit: deductionTotal,
        memo: `Payroll deductions: ${referenceNo}`,
        branchId: input.branchId,
      });
    }
    journalLines.push({
      chartOfAccountId: firstEmp.payrollPayableAccountId,
      debit: 0, credit: netTotal,
      memo: `Net payroll payable: ${referenceNo}`,
      branchId: input.branchId,
    });

    const eventId = randomUUID();
    await tx.businessEvent.create({
      data: {
        id: eventId, companyId: input.companyId,
        eventType: 'payroll.posted', sourceType: 'payroll_run', sourceId: run.id,
        correlationId, occurredAt: new Date(),
      },
    });

    const jeResult = await postJournalEntry(tx, {
      companyId: input.companyId, entryDate: input.periodEnd,
      postingKind: 'payroll', sourceType: 'payroll_run', sourceId: run.id,
      description: `Payroll ${referenceNo}: ${input.items.length} employees, gross ${grossTotal.toFixed(2)}`,
      currencyCode: 'BDT', exchangeRate: 1, createdBy: input.createdBy,
      lines: journalLines,
    }, correlationId);
    journalEntryNo = jeResult.entryNo;
  }

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.createdBy, correlationId,
      action: 'payroll_run.post', entityType: 'payroll_run', entityId: run.id,
      afterValue: JSON.stringify({
        reference_no: referenceNo, employee_count: input.items.length,
        gross: grossTotal, deductions: deductionTotal, net: netTotal, je_no: journalEntryNo,
      }),
    },
  });

  return {
    payrollRunId: run.id, referenceNo, status: 'posted',
    grossTotal: grossTotal.toFixed(2), deductionTotal: deductionTotal.toFixed(2),
    netTotal: netTotal.toFixed(2), journalEntryNo, beftnFile,
  };
}
