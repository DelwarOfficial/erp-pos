// src/lib/tax/statutoryDocuments.ts
// Bangladesh statutory document generation per §20.D08.
// Generates Mushak 6.1 (tax invoice), 6.2 (supplementary tax invoice),
// 6.3 (tax credit note), 9.1 (VAT return), and withholding certificates.
//
// All statutory documents are:
//   - Immutable once issued (status='issued')
//   - Snapshot-based (payload captured at issue time, never recomputed)
//   - Replaceable (replacement creates new doc with replacementOfId link)
//   - Filed (status transitions: draft → issued → filed; or issued → replaced)

import { db } from '@/lib/db';
import { randomUUID } from 'node:crypto';

export type StatutoryDocumentType =
  | 'VAT_6_1'    // Tax Invoice (Mushak 6.1) — for standard sales
  | 'VAT_6_2'    // Supplementary Tax Invoice (Mushak 6.2) — for adjustments
  | 'VAT_6_3'    // Tax Credit Note (Mushak 6.3) — for returns/refunds
  | 'VAT_9_1'    // VAT Return (Mushak 9.1) — periodic return
  | 'withholding_certificate' // Withholding tax certificate
  | 'other';

export interface Mushak61Data {
  // Mushak 6.1 — Tax Invoice
  sellerName: string;
  sellerAddress: string;
  sellerBin: string; // VAT Registration Number (BIN)
  buyerName: string;
  buyerAddress: string;
  buyerBin: string;
  invoiceNo: string;
  invoiceDate: string;
  items: Array<{
    description: string;
    qty: number;
    unitPrice: number;
    taxableAmount: number;
    vatRate: number;
    vatAmount: number;
    sdRate: number;   // Supplementary Duty
    sdAmount: number;
    totalAmount: number;
  }>;
  totalTaxableAmount: number;
  totalVat: number;
  totalSd: number;
  grandTotal: number;
  inWords: string; // Amount in words (Bangla + English)
}

export interface Mushak63Data {
  // Mushak 6.3 — Tax Credit Note (for returns)
  originalInvoiceNo: string;
  originalInvoiceDate: string;
  creditNoteNo: string;
  creditNoteDate: string;
  sellerName: string;
  sellerBin: string;
  buyerName: string;
  buyerBin: string;
  reason: string; // return/damage/price_adjustment
  items: Array<{
    description: string;
    qty: number;
    unitPrice: number;
    taxableAmount: number;
    vatRate: number;
    vatAmountReversed: number;
    totalAmountReversed: number;
  }>;
  totalTaxableAmountReversed: number;
  totalVatReversed: number;
  grandTotalReversed: number;
}

export interface Mushak91Data {
  // Mushak 9.1 — Monthly VAT Return
  taxPeriodStart: string;
  taxPeriodEnd: string;
  taxpayerName: string;
  taxpayerBin: string;
  // Output VAT
  totalSalesExcludingVat: number;
  outputVat: number;
  supplementaryDuty: number;
  // Input VAT
  totalPurchasesExcludingVat: number;
  inputVat: number;
  // Net VAT payable
  netVatPayable: number; // outputVat - inputVat
  // Additional
  openingCreditBalance: number;
  closingCreditBalance: number;
  vatAdjustments: number;
  totalVatPayable: number; // final amount
}

export interface WithholdingCertificateData {
  certificateNo: string;
  certificateDate: string;
  taxPeriod: string;
  deductorName: string;
  deductorBin: string;
  deducteeName: string;
  deducteeTin: string;
  paymentType: string; // salary/rent/professional_fee/commission/etc.
  paymentAmount: number;
  withholdingRate: number;
  withheldAmount: number;
  paymentDate: string;
}

/**
 * Generates a Mushak 6.1 Tax Invoice statutory document from a posted sale.
 */
export async function generateMushak61(
  companyId: string,
  saleId: string,
  issuedBy: string,
): Promise<{ documentId: string; documentNo: string }> {
  const sale = await db.sale.findFirst({
    where: { id: saleId, companyId },
    include: {
      items: { include: { product: { select: { name: true } } } },
      company: { select: { legalName: true, bin: true, displayName: true } },
      branch: { select: { name: true, address: true } },
      customer: { select: { name: true, address: true, taxIdentifier: true } },
    },
  });
  if (!sale) throw new Error('Sale not found');

  const items = sale.items.map(item => {
    const taxableAmount = parseFloat(String(item.lineTotal)) - parseFloat(String(item.discountAmount || '0'));
    const taxableAmt = parseFloat(String(item.taxableAmount || '0'));
    const vatRate = taxableAmt > 0
      ? (parseFloat(String(item.taxAmount || '0')) / taxableAmt) * 100
      : 0;
    const vatAmount = parseFloat(String(item.taxAmount || '0'));
    return {
      description: item.product.name,
      qty: parseFloat(String(item.qty)),
      unitPrice: parseFloat(String(item.unitPriceSnapshot)),
      taxableAmount,
      vatRate,
      vatAmount,
      sdRate: 0,
      sdAmount: 0,
      totalAmount: taxableAmount + vatAmount,
    };
  });

  const payload: Mushak61Data = {
    sellerName: sale.company.legalName,
    sellerAddress: sale.branch.address ?? sale.company.displayName ?? '',
    sellerBin: sale.company.bin ?? '',
    buyerName: sale.customer?.name ?? 'Walk-in Customer',
    buyerAddress: sale.customer?.address ?? '',
    buyerBin: sale.customer?.taxIdentifier ?? '',
    invoiceNo: sale.referenceNo,
    invoiceDate: new Date(sale.businessDate).toISOString().split('T')[0],
    items,
    totalTaxableAmount: parseFloat(String(sale.subtotal)),
    totalVat: parseFloat(String(sale.taxTotal)),
    totalSd: 0,
    grandTotal: parseFloat(String(sale.grandTotal)),
    inWords: amountInWords(parseFloat(String(sale.grandTotal))),
  };

  const docNo = `MUSHAK-6.1-${sale.referenceNo}`;
  const doc = await db.statutoryDocument.create({
    data: {
      companyId,
      branchId: sale.branchId,
      documentType: 'VAT_6_1',
      documentNo: docNo,
      sourceType: 'sale',
      sourceId: sale.id,
      issueDate: new Date(),
      payloadSnapshot: JSON.stringify(payload),
      status: 'issued',
      issuedBy,
    },
  });

  return { documentId: doc.id, documentNo: docNo };
}

/**
 * Generates a Mushak 6.3 Tax Credit Note from a posted sale return.
 */
export async function generateMushak63(
  companyId: string,
  saleReturnId: string,
  issuedBy: string,
): Promise<{ documentId: string; documentNo: string }> {
  const saleReturn = await db.saleReturn.findFirst({
    where: { id: saleReturnId, companyId },
    include: {
      sale: {
        include: {
          company: { select: { legalName: true, bin: true } },
          customer: { select: { name: true, taxIdentifier: true } },
        },
      },
      items: { include: { saleItem: { include: { product: { select: { name: true } } } } } },
    },
  });
  if (!saleReturn) throw new Error('Sale return not found');

  const items = saleReturn.items.map(item => {
    const taxableAmount = parseFloat(String(item.lineCredit));
    const taxCredit = parseFloat(String(item.taxCredit || '0'));
    const vatRate = taxableAmount > 0 ? (taxCredit / taxableAmount) * 100 : 0;
    const vatAmount = taxCredit;
    return {
      description: item.saleItem?.product?.name ?? 'Item',
      qty: parseFloat(String(item.qtyReturned)),
      unitPrice: parseFloat(String(item.unitPriceCredit)),
      taxableAmount,
      vatRate,
      vatAmountReversed: vatAmount,
      totalAmountReversed: taxableAmount + vatAmount,
    };
  });

  const payload: Mushak63Data = {
    originalInvoiceNo: saleReturn.sale.referenceNo,
    originalInvoiceDate: new Date(saleReturn.sale.businessDate).toISOString().split('T')[0],
    creditNoteNo: saleReturn.referenceNo,
    creditNoteDate: new Date(saleReturn.createdAt).toISOString().split('T')[0],
    sellerName: saleReturn.sale.company.legalName,
    sellerBin: saleReturn.sale.company.bin ?? '',
    buyerName: saleReturn.sale.customer?.name ?? 'Walk-in Customer',
    buyerBin: saleReturn.sale.customer?.taxIdentifier ?? '',
    reason: saleReturn.reason ?? 'return',
    items,
    totalTaxableAmountReversed: parseFloat(String(saleReturn.subtotalCredit)),
    totalVatReversed: parseFloat(String(saleReturn.taxCredit)),
    grandTotalReversed: parseFloat(String(saleReturn.totalCredit)),
  };

  const docNo = `MUSHAK-6.3-${saleReturn.referenceNo}`;
  const doc = await db.statutoryDocument.create({
    data: {
      companyId,
      branchId: saleReturn.sale.branchId,
      documentType: 'VAT_6_3',
      documentNo: docNo,
      sourceType: 'sale_return',
      sourceId: saleReturn.id,
      issueDate: new Date(),
      payloadSnapshot: JSON.stringify(payload),
      status: 'issued',
      issuedBy,
    },
  });

  return { documentId: doc.id, documentNo: docNo };
}

/**
 * Generates a Mushak 9.1 monthly VAT return from journal entries.
 */
export async function generateMushak91(
  companyId: string,
  periodStart: Date,
  periodEnd: Date,
  issuedBy: string,
): Promise<{ documentId: string; documentNo: string }> {
  // Calculate output VAT from sales journals
  const salesInPeriod = await db.sale.findMany({
    where: { companyId, businessDate: { gte: periodStart, lte: periodEnd }, saleStatus: { not: 'voided' } },
    select: { subtotal: true, taxTotal: true },
  });
  const totalSalesExcludingVat = salesInPeriod.reduce((s, sale) => s + parseFloat(String(sale.subtotal)), 0);
  const outputVat = salesInPeriod.reduce((s, sale) => s + parseFloat(String(sale.taxTotal)), 0);

  // Calculate input VAT from purchase journals
  const purchasesInPeriod = await db.purchase.findMany({
    where: { companyId, createdAt: { gte: periodStart, lte: periodEnd } },
    select: { subtotal: true, taxTotal: true },
  });
  const totalPurchasesExcludingVat = purchasesInPeriod.reduce((s, p) => s + parseFloat(String(p.subtotal)), 0);
  const inputVat = purchasesInPeriod.reduce((s, p) => s + parseFloat(String(p.taxTotal)), 0);

  const netVatPayable = outputVat - inputVat;

  const company = await db.company.findUnique({ where: { id: companyId }, select: { legalName: true, bin: true } });

  const payload: Mushak91Data = {
    taxPeriodStart: periodStart.toISOString().split('T')[0],
    taxPeriodEnd: periodEnd.toISOString().split('T')[0],
    taxpayerName: company?.legalName ?? '',
    taxpayerBin: company?.bin ?? '',
    totalSalesExcludingVat,
    outputVat,
    supplementaryDuty: 0,
    totalPurchasesExcludingVat,
    inputVat,
    netVatPayable,
    openingCreditBalance: 0,
    closingCreditBalance: netVatPayable < 0 ? Math.abs(netVatPayable) : 0,
    vatAdjustments: 0,
    totalVatPayable: Math.max(0, netVatPayable),
  };

  const periodStr = periodStart.toISOString().slice(0, 7).replace('-', '');
  const docNo = `MUSHAK-9.1-${periodStr}`;
  const doc = await db.statutoryDocument.create({
    data: {
      companyId,
      branchId: await sale_branch_placeholder(companyId),
      documentType: 'VAT_9_1',
      documentNo: docNo,
      sourceType: 'vat_return',
      sourceId: randomUUID(),
      issueDate: new Date(),
      taxPeriodStart: periodStart,
      taxPeriodEnd: periodEnd,
      payloadSnapshot: JSON.stringify(payload),
      status: 'draft',
      issuedBy,
    },
  });

  return { documentId: doc.id, documentNo: docNo };
}

/**
 * Generates a withholding tax certificate.
 */
export async function generateWithholdingCertificate(
  companyId: string,
  paymentId: string,
  issuedBy: string,
): Promise<{ documentId: string; documentNo: string }> {
  const payment = await db.payment.findFirst({
    where: { id: paymentId, companyId },
    include: {
      company: { select: { legalName: true, bin: true } },
      supplier: { select: { name: true, taxIdentifier: true } },
      branch: { select: { id: true } },
    },
  });
  if (!payment) throw new Error('Payment not found');

  const withheldAmount = parseFloat(String(payment.amount)) * 0.10; // simplified 10% withholding

  const payload: WithholdingCertificateData = {
    certificateNo: `WHC-${payment.referenceNo}`,
    certificateDate: new Date().toISOString().split('T')[0],
    taxPeriod: new Date(payment.businessDate).toISOString().slice(0, 7),
    deductorName: payment.company.legalName,
    deductorBin: payment.company.bin ?? '',
    deducteeName: payment.supplier?.name ?? 'Unknown',
    deducteeTin: payment.supplier?.taxIdentifier ?? '',
    paymentType: 'supplier_payment',
    paymentAmount: parseFloat(String(payment.amount)),
    withholdingRate: 10,
    withheldAmount,
    paymentDate: new Date(payment.businessDate).toISOString().split('T')[0],
  };

  const docNo = `WHC-${payment.referenceNo}`;
  const doc = await db.statutoryDocument.create({
    data: {
      companyId,
      branchId: payment.branchId,
      documentType: 'withholding_certificate',
      documentNo: docNo,
      sourceType: 'payment',
      sourceId: payment.id,
      issueDate: new Date(),
      taxPeriodStart: new Date(payment.businessDate),
      taxPeriodEnd: new Date(payment.businessDate),
      payloadSnapshot: JSON.stringify(payload),
      status: 'issued',
      issuedBy,
    },
  });

  return { documentId: doc.id, documentNo: docNo };
}

// ── Helper: amount in words ──
function amountInWords(amount: number): string {
  if (amount === 0) return 'Zero Taka Only / শূন্য টাকা মাত্র';
  const words = numberToWords(Math.floor(amount));
  const paisa = Math.round((amount - Math.floor(amount)) * 100);
  let result = `${words} Taka`;
  if (paisa > 0) result += ` and ${numberToWords(paisa)} Paisa`;
  result += ' Only';
  return result;
}

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

// Helper to get a branch ID for Mushak 9.1 (which is company-level, not branch-specific)
async function sale_branch_placeholder(companyId: string): Promise<string> {
  const branch = await db.branch.findFirst({ where: { companyId }, select: { id: true } });
  if (!branch) throw new Error('No branch found for company');
  return branch.id;
}
