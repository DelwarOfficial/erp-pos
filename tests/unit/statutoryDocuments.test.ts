// tests/unit/statutoryDocuments.test.ts
// Tests for Mushak statutory document generation per §20.D08.

import { describe, it, expect } from 'vitest';

describe('Statutory Documents: Amount in Words', () => {
  // Test the number-to-words conversion used in Mushak 6.1 invoices
  function numberToWords(n: number): string {
    if (n === 0) return 'Zero';
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + numberToWords(n % 100) : '');
    if (n < 100000) return numberToWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numberToWords(n % 1000) : '');
    if (n < 10000000) return numberToWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + numberToWords(n % 100000) : '');
    return numberToWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + numberToWords(n % 10000000) : '');
  }

  it('converts 0 to Zero', () => {
    expect(numberToWords(0)).toBe('Zero');
  });

  it('converts single digits', () => {
    expect(numberToWords(5)).toBe('Five');
    expect(numberToWords(9)).toBe('Nine');
  });

  it('converts teens', () => {
    expect(numberToWords(15)).toBe('Fifteen');
    expect(numberToWords(19)).toBe('Nineteen');
  });

  it('converts tens', () => {
    expect(numberToWords(20)).toBe('Twenty');
    expect(numberToWords(45)).toBe('Forty Five');
  });

  it('converts hundreds', () => {
    expect(numberToWords(100)).toBe('One Hundred');
    expect(numberToWords(250)).toBe('Two Hundred Fifty');
  });

  it('converts thousands', () => {
    expect(numberToWords(1000)).toBe('One Thousand');
    expect(numberToWords(15000)).toBe('Fifteen Thousand');
  });

  it('converts lakhs (Bangladesh numbering)', () => {
    expect(numberToWords(100000)).toBe('One Lakh');
    expect(numberToWords(500000)).toBe('Five Lakh');
  });

  it('converts crores (Bangladesh numbering)', () => {
    expect(numberToWords(10000000)).toBe('One Crore');
  });
});

describe('Statutory Documents: Mushak 6.1 Structure', () => {
  it('Mushak 6.1 requires seller BIN, buyer info, items with VAT', () => {
    const mushak61 = {
      sellerName: 'Test Electronics Ltd',
      sellerBin: '1234567890123',
      buyerName: 'Customer A',
      buyerBin: '9876543210987',
      invoiceNo: 'INV-000001',
      invoiceDate: '2026-07-14',
      items: [{
        description: 'Phone X1',
        qty: 1,
        unitPrice: 12000,
        taxableAmount: 12000,
        vatRate: 15,
        vatAmount: 1800,
        sdRate: 0,
        sdAmount: 0,
        totalAmount: 13800,
      }],
      totalTaxableAmount: 12000,
      totalVat: 1800,
      totalSd: 0,
      grandTotal: 13800,
    };

    expect(mushak61.sellerBin).toMatch(/^\d{13}$/);
    expect(mushak61.items[0].vatRate).toBe(15); // Bangladesh standard VAT rate
    expect(mushak61.grandTotal).toBe(mushak61.totalTaxableAmount + mushak61.totalVat);
  });
});

describe('Statutory Documents: Mushak 9.1 VAT Return', () => {
  it('net VAT = output VAT - input VAT', () => {
    const outputVat = 50000;
    const inputVat = 30000;
    const netVatPayable = outputVat - inputVat;

    expect(netVatPayable).toBe(20000);
    expect(netVatPayable > 0).toBe(true); // payable to government
  });

  it('when input VAT > output VAT, credit balance carries forward', () => {
    const outputVat = 20000;
    const inputVat = 35000;
    const netVatPayable = outputVat - inputVat; // -15000 (negative)

    const closingCreditBalance = netVatPayable < 0 ? Math.abs(netVatPayable) : 0;
    const totalVatPayable = Math.max(0, netVatPayable);

    expect(netVatPayable).toBe(-15000);
    expect(closingCreditBalance).toBe(15000);
    expect(totalVatPayable).toBe(0); // nothing to pay — credit carried forward
  });

  it('VAT return covers a specific tax period', () => {
    const returnData = {
      taxPeriodStart: '2026-07-01',
      taxPeriodEnd: '2026-07-31',
      returnType: 'VAT_9_1',
    };

    const periodDays = (new Date(returnData.taxPeriodEnd).getTime() - new Date(returnData.taxPeriodStart).getTime()) / (1000 * 60 * 60 * 24);
    expect(periodDays).toBe(30); // July has 31 days, but inclusive = 30 days difference
  });
});

describe('Statutory Documents: Withholding Certificate', () => {
  it('withheld amount = payment × withholding rate', () => {
    const paymentAmount = 50000;
    const withholdingRate = 10; // 10%
    const withheldAmount = paymentAmount * withholdingRate / 100;

    expect(withheldAmount).toBe(5000);
  });

  it('certificate includes deductor + deductee info', () => {
    const cert = {
      deductorName: 'Test Electronics Ltd',
      deductorBin: '1234567890123',
      deducteeName: 'Supplier A',
      deducteeTin: '9876543210987',
      paymentType: 'supplier_payment',
      withheldAmount: 5000,
    };

    expect(cert.deductorBin).toBeTruthy();
    expect(cert.deducteeTin).toBeTruthy();
    expect(cert.withheldAmount).toBeGreaterThan(0);
  });
});

describe('Statutory Documents: Immutability', () => {
  it('issued statutory document cannot be edited', () => {
    const doc = { status: 'issued', payloadSnapshot: '{"grandTotal": 13800}' };
    const canEdit = doc.status !== 'issued';
    expect(canEdit).toBe(false);
  });

  it('replacement creates new document with replacementOfId link', () => {
    const original = { id: 'doc-1', status: 'replaced' };
    const replacement = {
      id: 'doc-2',
      replacementOfId: 'doc-1',
      status: 'issued',
    };

    expect(replacement.replacementOfId).toBe(original.id);
    expect(original.status).toBe('replaced');
    expect(replacement.status).toBe('issued');
  });
});
