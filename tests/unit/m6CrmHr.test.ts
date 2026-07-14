// tests/unit/m6CrmHr.test.ts
// Tests for M6 — CRM lead validation, gift card issue, employee uniqueness.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

let companyId: string;
let userId: string;
let statusId: string;

beforeAll(async () => {
  await db.$connect();
  const company = await db.company.create({
    data: {
      code: 'TEST-M6-' + Date.now(),
      legalName: 'M6 Test Co', displayName: 'M6 Test',
      baseCurrencyCode: 'BDT', status: 'active',
    },
  });
  companyId = company.id;
  const user = await db.user.create({
    data: { companyId, name: 'Test', email: 'm6-' + Date.now() + '@test.local', passwordHash: 'x', accessScope: 'global' },
  });
  userId = user.id;
  const status = await db.leadStatus.create({
    data: { companyId, name: 'New', position: 1, isWon: false, isLost: false, isActive: true },
  });
  statusId = status.id;
});

afterAll(async () => {
  if (companyId) {
    try {
      await db.lead.deleteMany({ where: { companyId } });
      await db.leadStatus.deleteMany({ where: { companyId } });
      await db.giftCard.deleteMany({ where: { companyId } });
      await db.user.deleteMany({ where: { companyId } });
      await db.auditLog.deleteMany({ where: { companyId } });
      await db.company.deleteMany({ where: { id: companyId } });
    } catch (e) { console.error('Cleanup (non-fatal):', e); }
  }
  await db.$disconnect();
});

describe('M6 — CRM Leads', () => {
  it('creates a lead with phone', async () => {
    const lead = await db.lead.create({
      data: {
        companyId, statusId, name: 'John Doe',
        phone: '01712345678',
        createdBy: userId,
      },
    });
    expect(lead.name).toBe('John Doe');
    expect(lead.phone).toBe('01712345678');
  });

  it('creates a lead with email (no phone)', async () => {
    const lead = await db.lead.create({
      data: {
        companyId, statusId, name: 'Jane Doe',
        email: 'jane@test.local',
        createdBy: userId,
      },
    });
    expect(lead.email).toBe('jane@test.local');
  });

  it('lead status with isWon=true marks conversion', async () => {
    const wonStatus = await db.leadStatus.create({
      data: { companyId, name: 'Won', position: 5, isWon: true, isActive: true },
    });
    expect(wonStatus.isWon).toBe(true);
    expect(wonStatus.isLost).toBe(false);
  });

  it('lead status position is unique per company', async () => {
    await expect(
      db.leadStatus.create({
        data: { companyId, name: 'Duplicate', position: 1, isActive: true },
      }),
    ).rejects.toThrow();
  });
});

describe('M6 — Gift Cards', () => {
  it('issues a gift card with unique code', async () => {
    const card = await db.giftCard.create({
      data: {
        companyId, code: 'GC-TEST-' + Date.now(),
        faceValue: 1000, status: 'active',
        issuedBy: userId,
      },
    });
    expect(card.code).toMatch(/^GC-TEST-/);
    expect(card.faceValue.toString()).toBe('1000');
    expect(card.status).toBe('active');
  });

  it('gift card code is unique', async () => {
    const code = 'GC-DUP-' + Date.now();
    await db.giftCard.create({
      data: { companyId, code, faceValue: 500, issuedBy: userId },
    });
    await expect(
      db.giftCard.create({
        data: { companyId, code, faceValue: 500, issuedBy: userId },
      }),
    ).rejects.toThrow();
  });
});

describe('M6 — HR Employees', () => {
  it('employee number is unique per company', async () => {
    const branch = await db.branch.create({
      data: { companyId, name: 'Main', code: 'MAIN', isActive: true },
    });
    const coa = await db.chartOfAccount.create({
      data: { companyId, code: '6000', name: 'Salaries', accountClass: 'expense', accountSubtype: 'payroll', normalBalance: 'D' },
    });
    const coa2 = await db.chartOfAccount.create({
      data: { companyId, code: '2010', name: 'AP', accountClass: 'liability', accountSubtype: 'accounts_payable', normalBalance: 'C' },
    });

    await db.employee.create({
      data: {
        companyId, employeeNo: 'EMP001', branchId: branch.id,
        name: 'Test Employee', joinDate: new Date(),
        baseSalary: 30000,
        payrollExpenseAccountId: coa.id,
        payrollPayableAccountId: coa2.id,
      },
    });
    await expect(
      db.employee.create({
        data: {
          companyId, employeeNo: 'EMP001', branchId: branch.id,
          name: 'Duplicate', joinDate: new Date(),
          baseSalary: 30000,
          payrollExpenseAccountId: coa.id,
          payrollPayableAccountId: coa2.id,
        },
      }),
    ).rejects.toThrow();
  });
});
