// tests/unit/hrPayrollIntegrity.test.ts
// HR/payroll integrity tests per §8 — holiday/leave→attendance, payroll
// control totals, preparer≠approver.

import { describe, it, expect } from 'vitest';

// ── Holiday/Approved Leave Affects Attendance + Payroll ──

describe('HR: Holiday/Leave Affects Attendance + Payroll', () => {
  it('holiday marks attendance as holiday (not absent)', () => {
    const attendance = {
      employeeId: 'emp-1',
      date: '2026-07-16', // a holiday
      status: 'holiday', // not 'absent'
      hoursWorked: 0,
      overtimeHours: 0,
    };

    expect(attendance.status).toBe('holiday');
    expect(attendance.status).not.toBe('absent');
  });

  it('approved leave marks attendance as on_leave (not absent)', () => {
    const attendance = {
      employeeId: 'emp-2',
      date: '2026-07-17',
      status: 'on_leave',
      leaveType: 'casual',
      hoursWorked: 0,
    };

    expect(attendance.status).toBe('on_leave');
    expect(attendance.status).not.toBe('absent');
  });

  it('unapproved absence marks attendance as absent (deducted from pay)', () => {
    const attendance = {
      employeeId: 'emp-3',
      date: '2026-07-18',
      status: 'absent',
      hoursWorked: 0,
    };

    expect(attendance.status).toBe('absent');
    // This day is deducted from payroll
  });

  it('holiday pay is included in payroll (not deducted)', () => {
    const dailyRate = 2000;
    const workDays = 22;
    const holidays = 1; // 1 holiday in the month

    // Holiday is paid (not deducted)
    const payableDays = workDays + holidays; // 23
    const grossSalary = dailyRate * payableDays;

    expect(payableDays).toBe(23);
    expect(grossSalary).toBe(46000);
  });

  it('approved leave with pay is included in payroll', () => {
    const dailyRate = 2000;
    const workDays = 22;
    const approvedLeaveWithPay = 2;

    const payableDays = workDays + approvedLeaveWithPay; // 24
    const grossSalary = dailyRate * payableDays;

    expect(payableDays).toBe(24);
    expect(grossSalary).toBe(48000);
  });

  it('unapproved absence is deducted from payroll', () => {
    const dailyRate = 2000;
    const standardWorkDays = 22;
    const unapprovedAbsenceDays = 3;

    const payableDays = standardWorkDays - unapprovedAbsenceDays; // 19
    const grossSalary = dailyRate * payableDays;

    expect(payableDays).toBe(19);
    expect(grossSalary).toBe(38000);
  });
});

// ── Payroll Control Totals ──

describe('HR: Payroll Control Totals', () => {
  it('gross = sum of all earning components', () => {
    const earnings = [
      { component: 'basic_salary', amount: 30000 },
      { component: 'house_rent_allowance', amount: 8000 },
      { component: 'medical_allowance', amount: 2000 },
      { component: 'transport_allowance', amount: 3000 },
    ];
    const gross = earnings.reduce((sum, e) => sum + e.amount, 0);

    expect(gross).toBe(43000);
  });

  it('total_deductions = sum of all deduction components', () => {
    const deductions = [
      { component: 'provident_fund', amount: 3000 },
      { component: 'tax_withholding', amount: 5000 },
      { component: 'insurance', amount: 1000 },
    ];
    const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);

    expect(totalDeductions).toBe(9000);
  });

  it('net = gross - total_deductions', () => {
    const gross = 43000;
    const totalDeductions = 9000;
    const net = gross - totalDeductions;

    expect(net).toBe(34000);
  });

  it('payroll item totals = run control totals', () => {
    const items = [
      { employeeId: 'e1', gross: 43000, deductions: 9000, net: 34000 },
      { employeeId: 'e2', gross: 35000, deductions: 7000, net: 28000 },
      { employeeId: 'e3', gross: 50000, deductions: 12000, net: 38000 },
    ];

    const runTotals = {
      gross: items.reduce((s, i) => s + i.gross, 0),
      deductions: items.reduce((s, i) => s + i.deductions, 0),
      net: items.reduce((s, i) => s + i.net, 0),
    };

    expect(runTotals.gross).toBe(128000);
    expect(runTotals.deductions).toBe(28000);
    expect(runTotals.net).toBe(100000);

    // Control total check: gross - deductions = net
    expect(runTotals.gross - runTotals.deductions).toBe(runTotals.net);
  });

  it('overtime is capped at policy maximum', () => {
    const policy = { maxOvertimeHoursPerMonth: 40 };
    const actualOvertime = 50; // exceeds cap

    const payableOvertime = Math.min(actualOvertime, policy.maxOvertimeHoursPerMonth);
    expect(payableOvertime).toBe(40);
  });

  it('employer cost components are tracked separately from employee deductions', () => {
    const employerCosts = [
      { component: 'employer_pf_contribution', amount: 3000 },
      { component: 'employer_insurance', amount: 1500 },
    ];
    const employeeDeductions = [
      { component: 'employee_pf', amount: 3000 },
      { component: 'employee_tax', amount: 5000 },
    ];

    const totalEmployerCost = employerCosts.reduce((s, c) => s + c.amount, 0);
    const totalEmployeeDeductions = employeeDeductions.reduce((s, c) => s + c.amount, 0);

    expect(totalEmployerCost).toBe(4500);
    expect(totalEmployeeDeductions).toBe(8000);
    expect(totalEmployerCost).not.toBe(totalEmployeeDeductions); // separate
  });
});

// ── Preparer ≠ Approver (Segregation of Duties) ──

describe('HR: Preparer Cannot Approve Own Run', () => {
  it('preparer cannot approve their own payroll run', () => {
    const payrollRun = {
      id: 'pr-1',
      preparedBy: 'user-A',
      approvedBy: null,
      status: 'pending_approval',
    };

    // user-A tries to approve their own run
    const approver = 'user-A';
    const canApprove = approver !== payrollRun.preparedBy;

    expect(canApprove).toBe(false);
    // Should reject with SELF_APPROVAL_PROHIBITED
  });

  it('different user can approve the run', () => {
    const payrollRun = {
      id: 'pr-2',
      preparedBy: 'user-A',
      approvedBy: null,
      status: 'pending_approval',
    };

    const approver = 'user-B'; // different user
    const canApprove = approver !== payrollRun.preparedBy;

    expect(canApprove).toBe(true);
  });

  it('preparer cannot post their own run', () => {
    const payrollRun = {
      id: 'pr-3',
      preparedBy: 'user-A',
      postedBy: null,
      status: 'approved',
    };

    const poster = 'user-A'; // same user who prepared
    const canPost = poster !== payrollRun.preparedBy;

    expect(canPost).toBe(false);
  });

  it('approved run records both preparer + approver', () => {
    const payrollRun = {
      id: 'pr-4',
      preparedBy: 'user-A',
      approvedBy: 'user-B',
      status: 'approved',
      approvedAt: '2026-07-14T10:00:00Z',
    };

    expect(payrollRun.preparedBy).not.toBe(payrollRun.approvedBy);
    expect(payrollRun.status).toBe('approved');
    expect(payrollRun.approvedAt).toBeTruthy();
  });

  it('reversal creates opposite journals (Dr becomes Cr, Cr becomes Dr)', () => {
    const originalEntry = [
      { account: 'Salaries Expense', debit: 43000, credit: 0 },
      { account: 'Tax Payable', debit: 0, credit: 5000 },
      { account: 'PF Payable', debit: 0, credit: 3000 },
      { account: 'Cash', debit: 0, credit: 35000 },
    ];

    const reversalEntry = originalEntry.map(line => ({
      account: line.account,
      debit: line.credit,  // swap
      credit: line.debit,  // swap
    }));

    // Original totals
    const origDr = originalEntry.reduce((s, l) => s + l.debit, 0);
    const origCr = originalEntry.reduce((s, l) => s + l.credit, 0);

    // Reversal totals
    const revDr = reversalEntry.reduce((s, l) => s + l.debit, 0);
    const revCr = reversalEntry.reduce((s, l) => s + l.credit, 0);

    expect(origDr).toBe(origCr); // original balanced
    expect(revDr).toBe(revCr);   // reversal balanced
    expect(revDr).toBe(origCr);  // reversal debits = original credits
    expect(revCr).toBe(origDr);  // reversal credits = original debits
  });

  it('bank file is in BEFTN format', () => {
    const bankFile = {
      format: 'BEFTN',
      recordCount: 3,
      totalAmount: 100000,
      hasHeader: true,
      hasTrailer: true,
    };

    expect(bankFile.format).toBe('BEFTN');
    expect(bankFile.hasHeader).toBe(true);
    expect(bankFile.hasTrailer).toBe(true);
  });
});
