// tests/unit/beftn.test.ts
// Tests for BEFTN bank file format per §20.D18.

import { describe, it, expect } from 'vitest';
import { generateBEFTNFile, validateBEFTNFile, type BEFTNEntry, type BEFTNFileOptions } from '@/lib/payroll/beftn';

describe('BEFTN Bank File Generation', () => {
  const sampleOptions: BEFTNFileOptions = {
    senderName: 'Test Electronics Ltd',
    senderAccount: '12345678901234567',
    senderBankCode: '015',
    senderBranchCode: '1234',
    fileReferenceNo: 'PR-2026-07-001',
    valueDate: '2026-07-31',
    currency: 'BDT',
  };

  const sampleEntries: BEFTNEntry[] = [
    {
      serialNo: 1,
      beneficiaryName: 'Rahim Ahmed',
      beneficiaryAccount: '12345678901234567',
      bankCode: '015',
      branchCode: '5678',
      amount: 35000.00,
      accountType: 'salary',
      referenceNo: 'EMP-001',
      purpose: 'Salary',
    },
    {
      serialNo: 2,
      beneficiaryName: 'Karim Uddin',
      beneficiaryAccount: '98765432109876543',
      bankCode: '011',
      branchCode: '4321',
      amount: 45000.00,
      accountType: 'savings',
      referenceNo: 'EMP-002',
      purpose: 'Salary',
    },
  ];

  it('generates a valid BEFTN file with header + details + trailer', () => {
    const file = generateBEFTNFile(sampleEntries, sampleOptions);
    const lines = file.split('\n');

    expect(lines).toHaveLength(4); // 1 header + 2 details + 1 trailer
    expect(lines[0].startsWith('H|')).toBe(true);
    expect(lines[1].startsWith('D|')).toBe(true);
    expect(lines[2].startsWith('D|')).toBe(true);
    expect(lines[3].startsWith('T|')).toBe(true);
  });

  it('header contains sender info + total amount', () => {
    const file = generateBEFTNFile(sampleEntries, sampleOptions);
    const header = file.split('\n')[0].split('|');

    expect(header[0]).toBe('H');
    expect(header[1]).toContain('Test Electronics');
    expect(header[5]).toContain('PR-2026-07');
    expect(header[6]).toBe('20260731'); // YYYYMMDD
    expect(header[7]).toBe('BDT');
    expect(header[8]).toBe('000002'); // 2 entries
    // Total: 35000 + 45000 = 80000.00 → '80000.00' → '8000000' → 15 digits
    expect(header[9]).toBe('000000008000000');
  });

  it('detail records contain beneficiary info + amount', () => {
    const file = generateBEFTNFile(sampleEntries, sampleOptions);
    const detail1 = file.split('\n')[1].split('|');

    expect(detail1[0]).toBe('D');
    expect(detail1[1]).toBe('000001'); // serial no
    expect(detail1[2]).toContain('Rahim Ahmed');
    expect(detail1[6]).toBe('S'); // account type: salary → S
    // 35000.00 → 3500000 (15 digits)
    expect(detail1[7]).toBe('000000003500000');
  });

  it('trailer contains total record count + total amount', () => {
    const file = generateBEFTNFile(sampleEntries, sampleOptions);
    const trailer = file.split('\n')[3].split('|');

    expect(trailer[0]).toBe('T');
    expect(trailer[1]).toBe('000004'); // 4 total records (H + 2D + T)
    expect(trailer[2]).toBe('000002'); // 2 detail records
    expect(trailer[3]).toBe('000000008000000'); // total amount
  });

  it('amount is formatted as 15 digits without decimal point', () => {
    const entry: BEFTNEntry = {
      serialNo: 1,
      beneficiaryName: 'Test',
      beneficiaryAccount: '12345678901234567',
      bankCode: '015',
      branchCode: '1234',
      amount: 1234.56,
      accountType: 'salary',
      referenceNo: 'REF-1',
      purpose: 'Salary',
    };
    const file = generateBEFTNFile([entry], sampleOptions);
    const detail = file.split('\n')[1].split('|');

    // 1234.56 → 123456 → padded to 15 digits: 000000000123456
    expect(detail[7]).toBe('000000000123456');
    expect(detail[7]).toHaveLength(15);
  });
});

describe('BEFTN File Validation', () => {
  const validEntries: BEFTNEntry[] = [
    {
      serialNo: 1, beneficiaryName: 'Test', beneficiaryAccount: '12345678901234567',
      bankCode: '015', branchCode: '1234', amount: 10000, accountType: 'salary',
      referenceNo: 'E1', purpose: 'Salary',
    },
  ];
  const validOptions: BEFTNFileOptions = {
    senderName: 'Co', senderAccount: '12345678901234567',
    senderBankCode: '015', senderBranchCode: '1234',
    fileReferenceNo: 'REF', valueDate: '2026-07-31', currency: 'BDT',
  };

  it('valid file passes validation', () => {
    const file = generateBEFTNFile(validEntries, validOptions);
    const errors = validateBEFTNFile(file);
    expect(errors).toHaveLength(0);
  });

  it('rejects file with fewer than 3 records', () => {
    const errors = validateBEFTNFile('H|data\nT|data');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('at least 3 records');
  });

  it('rejects file where first record is not header', () => {
    const file = 'X|wrong\nD|data\nT|data';
    const errors = validateBEFTNFile(file);
    expect(errors.some(e => e.includes('header'))).toBe(true);
  });

  it('rejects file where last record is not trailer', () => {
    const file = 'H|data\nD|data\nX|wrong';
    const errors = validateBEFTNFile(file);
    expect(errors.some(e => e.includes('trailer'))).toBe(true);
  });

  it('detects trailer count mismatch', () => {
    const file = generateBEFTNFile(validEntries, validOptions);
    // Corrupt the trailer count
    const lines = file.split('\n');
    const trailer = lines[2].split('|');
    trailer[2] = '000099'; // wrong count
    lines[2] = trailer.join('|');
    const errors = validateBEFTNFile(lines.join('\n'));
    expect(errors.some(e => e.includes('count'))).toBe(true);
  });
});
