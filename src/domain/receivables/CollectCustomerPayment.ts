// CollectCustomerPayment: a customer pays towards what they owe.
//
// POST /payments records a sale receipt against the AR control account but
// links it to no sale, so a due collected after the sale reduced AR in the
// ledger while every sale and installment still looked unpaid. This command is
// the collection path for credit sales:
//
//   - the amount is applied to the customer's open installments, oldest due
//     date first (then oldest sale, then installment number), or only to the
//     sales named in `saleIds` when the cashier picks invoices;
//   - each installment it touches gets one payment allocation to its sale and
//     one installment allocation, in the same transaction as the payment;
//   - the journal is the one POST /payments posts for a sale receipt:
//     Dr the cash/bank account, Cr accounts receivable -- now tagged with the
//     customer and branch so the customer ledger and branch books show it.
//
// Overpayment is refused. Money beyond what is owed is an advance, which has
// its own ledger (customer_advance payments); guessing here would put it in
// AR as a negative balance.
//
// Reversing the payment (ReversePayment) needs nothing from this command: an
// installment's collected amount counts only posted payments
// (src/domain/receivables/balances.ts), so the installments reopen by
// themselves and reminders resume.
//
// Concurrency: the customer row is locked first, so two collections for the
// same customer are applied one after the other against fresh balances.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';
import { installmentBalances } from './balances';

export interface CollectCustomerPaymentInput {
  companyId: string;
  branchId: string;
  customerId: string;
  amount: Prisma.Decimal.Value;
  financialAccountId: string;
  paymentMethod: string;
  methodReference?: string;
  cashierShiftId?: string;
  businessDate: Date;
  collectedBy: string;
  /** Apply only to these sales (oldest due first among them). Default: all of the customer's. */
  saleIds?: string[];
  notes?: string;
}

export interface CollectCustomerPaymentResult {
  paymentId: string;
  referenceNo: string;
  amount: string;
  applied: Array<{ saleId: string; saleReferenceNo: string; installmentId: string; installmentNo: number; amount: string; remaining: string }>;
  customerOutstanding: string;
}

const CURRENCY = 'BDT';

export async function collectCustomerPayment(
  tx: Prisma.TransactionClient,
  input: CollectCustomerPaymentInput,
  correlationId: string,
): Promise<CollectCustomerPaymentResult> {
  let amount: Prisma.Decimal;
  try { amount = new Prisma.Decimal(input.amount); } catch { throw new DomainError('VALIDATION_FAILED', 'Amount is not a number', {}, 400); }
  if (amount.lte(0) || amount.decimalPlaces() > 2) {
    throw new DomainError('VALIDATION_FAILED', 'Amount must be positive, to at most two decimal places', {}, 400);
  }
  if (['gift_card', 'store_credit'].includes(input.paymentMethod)) {
    throw new DomainError('VALIDATION_FAILED', 'Gift cards and store credit are not collection tenders', {}, 400);
  }

  // One collection per customer at a time.
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${input.customerId} AND company_id = ${input.companyId} FOR UPDATE`;
  const customer = await tx.customer.findFirst({ where: { id: input.customerId, companyId: input.companyId, deletedAt: null }, select: { id: true } });
  if (!customer) throw new DomainError('RESOURCE_NOT_FOUND', 'Customer not found', {}, 404);

  const account = await tx.financialAccount.findFirst({
    where: { id: input.financialAccountId, companyId: input.companyId, isActive: true },
    select: { id: true, chartOfAccountId: true, currencyCode: true },
  });
  if (!account) throw new DomainError('VALIDATION_FAILED', 'Financial account not found or inactive', {}, 404);
  if (account.currencyCode !== CURRENCY) throw new DomainError('VALIDATION_FAILED', `Collections are in ${CURRENCY}`, {}, 409);
  const policies = await tx.accountingPolicy.findUnique({ where: { companyId: input.companyId }, select: { arAccountId: true } });
  if (!policies) throw new DomainError('VALIDATION_FAILED', 'Accounting policies are not configured', {}, 409);

  const open = (await installmentBalances(tx, input.companyId, { customerId: input.customerId, saleIds: input.saleIds }))
    .filter(b => b.outstanding.gt(0));
  const owed = open.reduce((sum, b) => sum.plus(b.outstanding), new Prisma.Decimal(0));
  if (owed.isZero()) throw new DomainError('VALIDATION_FAILED', 'Nothing is outstanding for this customer', {}, 409);
  if (amount.gt(owed)) {
    throw new DomainError('VALIDATION_FAILED',
      `The customer owes ${owed.toFixed(2)}; record anything above that as a customer advance`,
      { outstanding: owed.toFixed(2), amount: amount.toFixed(2) }, 409);
  }

  // Oldest due first.
  const plan: Array<{ balance: (typeof open)[number]; applied: Prisma.Decimal }> = [];
  let left = amount;
  for (const balance of open) {
    if (left.isZero()) break;
    const applied = Prisma.Decimal.min(left, balance.outstanding);
    plan.push({ balance, applied });
    left = left.minus(applied);
  }

  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId, branchId: input.branchId,
    documentType: 'PAYMENT', fiscalYear: input.businessDate.getFullYear(), prefix: 'PMT-',
  });
  const payment = await tx.payment.create({
    data: {
      companyId: input.companyId, branchId: input.branchId, referenceNo, clientTxnId: randomUUID(),
      paymentType: 'sale_receipt', direction: 'incoming', customerId: input.customerId,
      financialAccountId: account.id, cashierShiftId: input.cashierShiftId ?? null,
      currencyCode: CURRENCY, exchangeRate: 1, amount, baseAmount: amount,
      paymentMethod: input.paymentMethod, methodReference: input.methodReference ?? null,
      chequeStatus: input.paymentMethod === 'cheque' ? 'pending_clearance' : 'not_applicable',
      paymentStatus: 'posted', businessDate: input.businessDate,
      receivedOrPaidAt: new Date(), postedAt: new Date(), createdBy: input.collectedBy, notes: input.notes ?? null,
    },
  });

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: { id: eventId, companyId: input.companyId, eventType: 'customer_payment.collected',
      sourceType: 'payment', sourceId: payment.id, correlationId, occurredAt: new Date() },
  });
  let lineNo = 1;
  for (const { balance, applied } of plan) {
    const allocation = await tx.paymentAllocation.create({
      data: {
        companyId: input.companyId, paymentId: payment.id, eventId, eventLineNo: lineNo++,
        saleId: balance.saleId, allocationSource: 'direct',
        allocatedAmount: applied, allocatedBaseAmount: applied, createdBy: input.collectedBy,
      },
    });
    await tx.installmentAllocation.create({
      data: { companyId: input.companyId, installmentId: balance.installmentId, paymentAllocationId: allocation.id, allocatedAmount: applied },
    });
  }

  // Cash on the collecting branch; AR comes off the branch of each sale paid,
  // so a customer who bought at one branch and pays at another lowers the
  // receivable where it was booked (blueprint §5.10: cross-branch collection
  // places cash and AR lines on their actual branches).
  const arByBranch = new Map<string, Prisma.Decimal>();
  for (const { balance, applied } of plan) arByBranch.set(balance.branchId, (arByBranch.get(balance.branchId) ?? new Prisma.Decimal(0)).plus(applied));
  await postJournalEntry(tx, {
    companyId: input.companyId, entryDate: input.businessDate,
    postingKind: 'sale_receipt', sourceType: 'payment', sourceId: payment.id,
    description: `Customer collection ${referenceNo}`, currencyCode: CURRENCY, exchangeRate: 1, createdBy: input.collectedBy,
    lines: [
      { chartOfAccountId: account.chartOfAccountId, financialAccountId: account.id, branchId: input.branchId,
        debit: amount, credit: 0, memo: `Collection ${referenceNo}` },
      ...[...arByBranch].map(([branchId, credit]) => ({
        chartOfAccountId: policies.arAccountId, customerId: input.customerId, branchId,
        debit: 0, credit, memo: `Collection ${referenceNo}`,
      })),
    ],
  }, correlationId);

  await tx.auditLog.create({
    data: { companyId: input.companyId, userId: input.collectedBy, correlationId,
      action: 'customer_payment.collect', entityType: 'payment', entityId: payment.id,
      afterValue: JSON.stringify({ reference_no: referenceNo, customer_id: input.customerId, amount: amount.toFixed(2),
        applied: plan.map(p => ({ installment_id: p.balance.installmentId, amount: p.applied.toFixed(2) })) }) },
  });

  return {
    paymentId: payment.id, referenceNo, amount: amount.toFixed(2),
    applied: plan.map(({ balance, applied }) => ({
      saleId: balance.saleId, saleReferenceNo: balance.saleReferenceNo, installmentId: balance.installmentId,
      installmentNo: balance.installmentNo, amount: applied.toFixed(2), remaining: balance.outstanding.minus(applied).toFixed(2),
    })),
    customerOutstanding: owed.minus(amount).toFixed(2),
  };
}
