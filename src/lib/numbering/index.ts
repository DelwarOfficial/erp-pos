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
import { randomUUID } from 'node:crypto';

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

function isMariaDb(): boolean {
  return /^(mysql|mariadb):\/\//i.test(process.env.DATABASE_URL ?? '');
}

async function reserveMariaDbRange(
  tx: Prisma.TransactionClient,
  params: DocumentNumberParams,
  count: number,
): Promise<{ sequenceId: string; rangeStart: bigint; rangeEnd: bigint }> {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('INVALID_SEQUENCE_COUNT');
  const padding = params.padding ?? 6;
  const branchId = params.branchId ?? null;
  const initialNext = BigInt(count + 1);
  const generatedId = randomUUID();

  await tx.$executeRaw`
    INSERT INTO document_sequences
      (id, company_id, branch_id, document_type, fiscal_year, prefix, next_number, padding, version)
    VALUES
      (${generatedId}, ${params.companyId}, ${branchId}, ${params.documentType}, ${params.fiscalYear},
       ${params.prefix}, ${initialNext}, ${padding}, 1)
    ON DUPLICATE KEY UPDATE
      next_number = next_number + ${BigInt(count)},
      version = version + 1
  `;

  const sequence = await tx.documentSequence.findFirst({
    where: {
      companyId: params.companyId,
      branchId,
      documentType: params.documentType,
      fiscalYear: params.fiscalYear,
    },
    select: { id: true, nextNumber: true },
  });
  if (!sequence) throw new Error('SEQUENCE_ALLOCATION_FAILED');

  return {
    sequenceId: sequence.id,
    rangeStart: sequence.nextNumber - BigInt(count),
    rangeEnd: sequence.nextNumber - BigInt(1),
  };
}

export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  params: DocumentNumberParams,
): Promise<DocumentNumberResult> {
  const padding = params.padding ?? 6;

  if (isMariaDb()) {
    const allocation = await reserveMariaDbRange(tx, params, 1);
    return {
      documentNumber: `${params.prefix}${String(allocation.rangeStart).padStart(padding, '0')}`,
      sequenceId: allocation.sequenceId,
      nextNumber: allocation.rangeStart,
    };
  }

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
  if (isMariaDb()) {
    const leaseSequenceType = `__LEASE__:${params.documentType}:${params.prefix}`;
    const allocation = await reserveMariaDbRange(tx, {
      companyId: params.companyId,
      branchId: null,
      documentType: leaseSequenceType,
      fiscalYear: 0,
      prefix: params.prefix,
    }, params.count);
    const lease = await tx.documentNumberLease.create({
      data: {
        companyId: params.companyId,
        branchId: params.branchId,
        deviceId: params.deviceId,
        documentType: params.documentType,
        prefix: params.prefix,
        rangeStart: allocation.rangeStart,
        rangeEnd: allocation.rangeEnd,
        nextNumber: allocation.rangeStart,
        expiresAt: params.expiresAt,
        status: 'active',
      },
    });
    return {
      rangeStart: allocation.rangeStart,
      rangeEnd: allocation.rangeEnd,
      nextNumber: allocation.rangeStart,
      leaseId: lease.id,
    };
  }

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
