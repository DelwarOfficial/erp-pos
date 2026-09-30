import { Prisma } from '@prisma/client';
import { postJournalEntry, type JournalLineInput } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';

/** Inventory value and its offset are posted atomically with the stock document. */
export async function postInventoryVarianceJournal(tx: Prisma.TransactionClient, input: {
  companyId: string; branchId: string; sourceType: string; sourceId: string; referenceNo: string;
  businessDate: Date; userId: string; values: { value: Prisma.Decimal.Value; reasonCodeId?: string | null }[];
}, correlationId: string) {
  const policy = await tx.accountingPolicy.findUnique({ where: { companyId: input.companyId } });
  const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId }, select: { baseCurrencyCode: true } });
  if (!policy) throw new DomainError('VALIDATION_FAILED', 'Configure accounting policy before posting inventory variances', {}, 409);
  const reasons = await tx.inventoryReasonCode.findMany({ where: { companyId: input.companyId, id: { in: [...new Set(input.values.flatMap(value => value.reasonCodeId ? [value.reasonCodeId] : []))] }, isActive: true } });
  const totals = new Map<string, Prisma.Decimal>();
  for (const row of input.values) {
    const value = new Prisma.Decimal(row.value);
    if (value.isZero()) continue;
    const reason = reasons.find(reason => reason.id === row.reasonCodeId);
    if (row.reasonCodeId && !reason) throw new DomainError('VALIDATION_FAILED', 'Variance reason is unavailable', {}, 400);
    const account = reason?.defaultExpenseAccountId ?? policy.inventoryWriteOffAccountId;
    if (!account) throw new DomainError('VALIDATION_FAILED', 'Configure a variance expense account on the selected reason or inventory write-off policy', {}, 409);
    if (account === policy.inventoryAccountId) throw new DomainError('VALIDATION_FAILED', 'Inventory and variance offset accounts must differ', {}, 400);
    totals.set(account, (totals.get(account) ?? new Prisma.Decimal(0)).plus(value));
  }
  const lines: JournalLineInput[] = [];
  for (const [account, value] of totals) {
    if (value.isZero()) continue;
    const amount = value.abs();
    lines.push({ chartOfAccountId: policy.inventoryAccountId, branchId: input.branchId, debit: value.gt(0) ? amount : 0, credit: value.lt(0) ? amount : 0 });
    lines.push({ chartOfAccountId: account, branchId: input.branchId, debit: value.lt(0) ? amount : 0, credit: value.gt(0) ? amount : 0 });
  }
  if (!lines.length) return null;
  return postJournalEntry(tx, { companyId: input.companyId, entryDate: input.businessDate,
    postingKind: input.sourceType, sourceType: input.sourceType, sourceId: input.sourceId,
    description: `Inventory variance ${input.referenceNo}`, currencyCode: company.baseCurrencyCode, exchangeRate: 1,
    createdBy: input.userId, lines }, correlationId);
}
