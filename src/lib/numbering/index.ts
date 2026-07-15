// src/lib/numbering/index.ts
// next_document_number() per §5.3 document_sequences + §16 SQL function spec.
//
// Blueprint §16: locks the document_sequences row FOR UPDATE, increments
// next_number, formats with prefix+padding, returns the document number.
// Rollback of the parent transaction also rolls back the increment.
//
// SQLite sandbox: emulate using a deterministic update-and-read sequence
// inside the parent Prisma transaction. Concurrent transactions serialize
// on the row update.

import { Prisma } from '@prisma/client';

export interface DocumentNumberParams {
  companyId: string;
  branchId?: string | null;
  documentType: string;
  fiscalYear: number;
  prefix: string;
  padding?: number; // default 6
}

export interface DocumentNumberResult {
  documentNumber: string;
  sequenceId: string;
  nextNumber: bigint;
}

export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  params: DocumentNumberParams,
): Promise<DocumentNumberResult> {
  const padding = params.padding ?? 6;

  // Find existing sequence (companyId + branchId|null + documentType + fiscalYear).
  // If not found, create it atomically.
  const existing = await tx.documentSequence.findFirst({
    where: {
      companyId: params.companyId,
      branchId: params.branchId ?? null,
      documentType: params.documentType,
      fiscalYear: params.fiscalYear,
    },
  });

  let sequenceId: string;
  let nextNumber: bigint;

  if (!existing) {
    const created = await tx.documentSequence.create({
      data: {
        companyId: params.companyId,
        branchId: params.branchId ?? null,
        documentType: params.documentType,
        fiscalYear: params.fiscalYear,
        prefix: params.prefix,
        nextNumber: BigInt(2), // we are about to issue #1
        padding,
        version: 1,
      },
    });
    sequenceId = created.id;
    nextNumber = BigInt(1);
  } else {
    // Atomically increment — equivalent to FOR UPDATE on the row.
    const updated = await tx.documentSequence.update({
      where: { id: existing.id },
      data: { nextNumber: { increment: 1 }, version: { increment: 1 } },
    });
    sequenceId = existing.id;
    nextNumber = updated.nextNumber - BigInt(1); // value before increment is the issued number
  }

  const formatted = String(nextNumber).padStart(padding, '0');
  const documentNumber = `${params.prefix}${formatted}`;
  return { documentNumber, sequenceId, nextNumber };
}

/**
 * Lease a range of document numbers for offline use (§5.3 document_number_leases).
 * The EXCLUDE USING gist constraint in Postgres prevents overlapping ranges;
// in SQLite sandbox, we validate overlap in app code.
 */
export async function leaseDocumentNumbers(
  tx: Prisma.TransactionClient,
  params: {
    companyId: string;
    branchId: string;
    deviceId: string;
    documentType: string;
    prefix: string;
    count: number;
    expiresAt: Date;
  },
): Promise<{ rangeStart: bigint; rangeEnd: bigint; nextNumber: bigint; leaseId: string }> {
  // Find the current max leased range_end for this company/type/prefix
  const leases = await tx.documentNumberLease.findMany({
    where: {
      companyId: params.companyId,
      documentType: params.documentType,
      prefix: params.prefix,
    },
  });
  let maxEnd = BigInt(0);
  for (const l of leases) {
    if (l.rangeEnd > maxEnd) maxEnd = l.rangeEnd;
  }

  const rangeStart = maxEnd + BigInt(1);
  const rangeEnd = maxEnd + BigInt(params.count);
  const lease = await tx.documentNumberLease.create({
    data: {
      companyId: params.companyId,
      branchId: params.branchId,
      deviceId: params.deviceId,
      documentType: params.documentType,
      prefix: params.prefix,
      rangeStart,
      rangeEnd,
      nextNumber: rangeStart,
      expiresAt: params.expiresAt,
      status: 'active',
    },
  });

  return { rangeStart, rangeEnd, nextNumber: rangeStart, leaseId: lease.id };
}
