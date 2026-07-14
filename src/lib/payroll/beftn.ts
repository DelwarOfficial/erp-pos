// src/lib/payroll/beftn.ts
// BEFTN (Bangladesh Electronic Funds Transfer Network) bank file generator.
// Per §20.D18 — payroll bank file must be in BEFTN format.

export interface BEFTNEntry {
  serialNo: number;
  beneficiaryName: string;
  beneficiaryAccount: string;
  bankCode: string;
  branchCode: string;
  amount: number;
  accountType: 'savings' | 'current' | 'salary';
  referenceNo: string;
  purpose: string;
}

export interface BEFTNFileOptions {
  senderName: string;
  senderAccount: string;
  senderBankCode: string;
  senderBranchCode: string;
  fileReferenceNo: string;
  valueDate: string;
  currency: string;
}

export function generateBEFTNFile(entries: BEFTNEntry[], options: BEFTNFileOptions): string {
  const lines: string[] = [];
  const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0);

  // Header
  lines.push([
    'H',
    options.senderName.padEnd(35).slice(0, 35),
    options.senderAccount.padEnd(17).slice(0, 17),
    options.senderBankCode.padStart(3, '0'),
    options.senderBranchCode.padStart(4, '0'),
    options.fileReferenceNo.padEnd(16).slice(0, 16),
    options.valueDate.replace(/-/g, ''),
    options.currency.padEnd(3).slice(0, 3),
    String(entries.length).padStart(6, '0'),
    totalAmount.toFixed(2).replace('.', '').padStart(15, '0'),
  ].join('|'));

  // Details
  for (const entry of entries) {
    lines.push([
      'D',
      String(entry.serialNo).padStart(6, '0'),
      entry.beneficiaryName.padEnd(35).slice(0, 35),
      entry.beneficiaryAccount.padEnd(17).slice(0, 17),
      entry.bankCode.padStart(3, '0'),
      entry.branchCode.padStart(4, '0'),
      entry.accountType.charAt(0).toUpperCase(),
      entry.amount.toFixed(2).replace('.', '').padStart(15, '0'),
      entry.referenceNo.padEnd(16).slice(0, 16),
      entry.purpose.padEnd(20).slice(0, 20),
    ].join('|'));
  }

  // Trailer
  lines.push([
    'T',
    String(entries.length + 2).padStart(6, '0'),
    String(entries.length).padStart(6, '0'),
    totalAmount.toFixed(2).replace('.', '').padStart(15, '0'),
    ''.padEnd(50),
  ].join('|'));

  return lines.join('\n');
}

export function validateBEFTNFile(content: string): string[] {
  const errors: string[] = [];
  const lines = content.split('\n').filter(l => l.trim());

  if (lines.length < 3) {
    errors.push('File must have at least 3 records (header + 1 detail + trailer)');
    return errors;
  }

  const header = lines[0].split('|');
  if (header[0] !== 'H') errors.push('First record must be header (type H)');
  if (header.length < 10) errors.push('Header must have 10 fields');

  const detailCount = lines.length - 2;
  for (let i = 1; i <= detailCount; i++) {
    const detail = lines[i].split('|');
    if (detail[0] !== 'D') errors.push(`Record ${i + 1} must be detail (type D)`);
    if (detail.length < 10) errors.push(`Detail record ${i} must have 10 fields`);
    if (detail[7] && !/^\d{15}$/.test(detail[7])) {
      errors.push(`Detail record ${i} has invalid amount format`);
    }
  }

  const trailer = lines[lines.length - 1].split('|');
  if (trailer[0] !== 'T') errors.push('Last record must be trailer (type T)');

  const trailerDetailCount = parseInt(trailer[2] || '0', 10);
  if (trailerDetailCount !== detailCount) {
    errors.push(`Trailer detail count (${trailerDetailCount}) does not match actual (${detailCount})`);
  }

  return errors;
}
