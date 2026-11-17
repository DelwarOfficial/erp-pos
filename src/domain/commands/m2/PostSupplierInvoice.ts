// PostSupplierInvoice: the supplier's bill for goods already received.
//
// Receiving posts Dr Inventory / Cr GRNI (goods received not invoiced). Until
// now nothing ever moved that clearing balance to the supplier's payable, so a
// supplier payment (Dr AP) left AP in debit while GRNI stayed in credit
// forever, and AP aging showed nothing owed.
//
// The invoice posts, in base currency:
//   Dr GRNI            the value received on this purchase (once)
//   Dr input VAT       the invoice's recoverable tax, if any
//   Dr/Cr variance     invoice net of tax minus value received (price difference)
//   Cr AP              the invoice total, tagged with the supplier
//
// One invoice per purchase: the whole received value is cleared at once and
// the purchase is marked invoiced. Partial invoicing is not supported yet: a
// later receiving on an invoiced purchase stays in GRNI.

import { Prisma } from '@prisma/client';
import { postJournalEntry, type JournalLineInput } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';

export interface PostSupplierInvoiceInput {
  companyId: string;
  purchaseId: string;
  supplierInvoiceNo: string;
  invoiceDate: Date;
  /** Invoice total including tax, in the purchase currency. */
  amount: Prisma.Decimal.Value;
  /** Recoverable input tax included in `amount`, in the purchase currency. */
  taxAmount?: Prisma.Decimal.Value;
  /** Tax component whose input account receives the tax (required when taxAmount > 0). */
  inputTaxComponentId?: string;
  postedBy: string;
}

export interface PostSupplierInvoiceResult {
  purchaseId: string;
  journalEntryId: string;
  receivedValue: string;
  invoiceBase: string;
  variance: string;
}

export async function postSupplierInvoice(
  tx: Prisma.TransactionClient,
  input: PostSupplierInvoiceInput,
  correlationId: string,
): Promise<PostSupplierInvoiceResult> {
  const amount = new Prisma.Decimal(input.amount);
  const tax = new Prisma.Decimal(input.taxAmount ?? 0);
  if (amount.lte(0) || amount.decimalPlaces() > 2) throw new DomainError('VALIDATION_FAILED', 'Invoice amount must be positive, to at most two decimal places', {}, 400);
  if (tax.isNegative() || tax.gt(amount) || tax.decimalPlaces() > 2) throw new DomainError('VALIDATION_FAILED', 'Tax must be between zero and the invoice amount', {}, 400);

  // Lock the purchase so two invoices cannot both clear it.
  await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${input.purchaseId} AND company_id = ${input.companyId} FOR UPDATE`;
  const purchase = await tx.purchase.findFirst({ where: { id: input.purchaseId, companyId: input.companyId } });
  if (!purchase) throw new DomainError('RESOURCE_NOT_FOUND', 'Purchase not found', {}, 404);
  if (purchase.invoiceStatus === 'invoiced') throw new DomainError('VALIDATION_FAILED', 'This purchase already has its supplier invoice', {}, 409);

  const policy = await tx.accountingPolicy.findUnique({ where: { companyId: input.companyId } });
  if (!policy) throw new DomainError('VALIDATION_FAILED', 'Accounting policies are not configured', {}, 409);
  if (!policy.grniAccountId) {
    throw new DomainError('VALIDATION_FAILED', 'Receiving posts straight to accounts payable here (no GRNI account), so the payable is already recorded', {}, 409);
  }

  // Value received and still sitting in GRNI for this purchase.
  const receivings = await tx.purchaseReceiving.findMany({ where: { companyId: input.companyId, purchaseId: purchase.id }, select: { id: true } });
  if (receivings.length === 0) throw new DomainError('VALIDATION_FAILED', 'Receive the goods before posting the supplier invoice', {}, 409);
  const grni = await tx.journalLine.aggregate({
    where: {
      companyId: input.companyId, chartOfAccountId: policy.grniAccountId,
      journalEntry: { sourceType: 'purchase_receiving', sourceId: { in: receivings.map(r => r.id) }, status: 'posted' },
    },
    _sum: { creditBase: true, debitBase: true },
  });
  const receivedValue = new Prisma.Decimal(grni._sum.creditBase ?? 0).minus(grni._sum.debitBase ?? 0).toDecimalPlaces(2);
  if (receivedValue.lte(0)) throw new DomainError('VALIDATION_FAILED', 'Nothing received on this purchase is waiting for an invoice', {}, 409);

  const rate = new Prisma.Decimal(purchase.exchangeRate);
  const invoiceBase = amount.mul(rate).toDecimalPlaces(2);
  const taxBase = tax.mul(rate).toDecimalPlaces(2);
  const variance = invoiceBase.minus(taxBase).minus(receivedValue);

  let inputTaxAccountId: string | null = null;
  if (taxBase.gt(0)) {
    if (!input.inputTaxComponentId) throw new DomainError('VALIDATION_FAILED', 'Choose the tax the invoice charges', {}, 400);
    const component = await tx.taxComponent.findFirst({ where: { id: input.inputTaxComponentId, companyId: input.companyId }, select: { inputAccountId: true } });
    if (!component?.inputAccountId) throw new DomainError('VALIDATION_FAILED', 'That tax has no input tax account set', {}, 409);
    inputTaxAccountId = component.inputAccountId;
  }

  const memo = `Supplier invoice ${input.supplierInvoiceNo}`;
  const lines: JournalLineInput[] = [
    { chartOfAccountId: policy.grniAccountId, branchId: purchase.branchId, debit: receivedValue, credit: 0, memo },
  ];
  if (inputTaxAccountId) lines.push({ chartOfAccountId: inputTaxAccountId, branchId: purchase.branchId, debit: taxBase, credit: 0, memo });
  if (!variance.isZero()) {
    lines.push({ chartOfAccountId: policy.purchaseVarianceAccountId, branchId: purchase.branchId,
      debit: variance.gt(0) ? variance : 0, credit: variance.lt(0) ? variance.abs() : 0, memo: `Price difference on ${input.supplierInvoiceNo}` });
  }
  lines.push({ chartOfAccountId: policy.apAccountId, supplierId: purchase.supplierId, branchId: purchase.branchId, debit: 0, credit: invoiceBase, memo });

  const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId }, select: { baseCurrencyCode: true } });
  const entry = await postJournalEntry(tx, {
    companyId: input.companyId, entryDate: input.invoiceDate,
    postingKind: 'supplier_invoice', sourceType: 'supplier_invoice', sourceId: purchase.id,
    description: `${memo} for ${purchase.referenceNo}`, currencyCode: company.baseCurrencyCode, exchangeRate: 1,
    createdBy: input.postedBy, lines,
  }, correlationId);

  await tx.purchase.update({ where: { id: purchase.id }, data: { invoiceStatus: 'invoiced', supplierInvoiceNo: input.supplierInvoiceNo } });
  await tx.auditLog.create({
    data: { companyId: input.companyId, userId: input.postedBy, correlationId,
      action: 'purchase.invoice', entityType: 'purchase', entityId: purchase.id,
      afterValue: JSON.stringify({ supplier_invoice_no: input.supplierInvoiceNo, amount: amount.toFixed(2), tax: tax.toFixed(2),
        received_value: receivedValue.toFixed(2), variance: variance.toFixed(2) }) },
  });

  return { purchaseId: purchase.id, journalEntryId: entry.journalEntryId, receivedValue: receivedValue.toFixed(2), invoiceBase: invoiceBase.toFixed(2), variance: variance.toFixed(2) };
}
