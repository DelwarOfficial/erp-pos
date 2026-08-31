import { requireTenantContext } from './transaction';
import { tenantDb } from './tenant';

export async function checkFiscalOverlap(tx: any, companyId: string, start: Date, end: Date, excludeId?: string) {
  const ctx = requireTenantContext();
  if (companyId !== ctx.companyId) throw new Error('TENANT_VIOLATION');
  const overlap = await tx.fiscal_periods.findFirst({
    where: {
      company_id: companyId,
      id: excludeId ? { not: excludeId } : undefined,
      OR: [{ start_date: { lte: end }, end_date: { gte: start } }]
    }
  });
  if (overlap) throw new Error('FISCAL_PERIOD_OVERLAP');
}

export async function nextDocumentNumber(tx: any, companyId: string, type: string): Promise<string> {
  const ctx = requireTenantContext();
  if (companyId !== ctx.companyId) throw new Error('TENANT_VIOLATION');
  const seq = await tx.document_sequences.findFirst({ where: { company_id: companyId, document_type: type } });
  if (!seq) throw new Error('SEQUENCE_NOT_FOUND');
  const updated = await tx.document_sequences.update({
    where: { id: seq.id },
    data: { next_number: { increment: 1n } }
  });
  return `${seq.prefix}${String(updated.next_number - 1n).padStart(seq.padding, '0')}`;
}
