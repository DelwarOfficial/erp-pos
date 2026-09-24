// Data-subject request fulfilment.
//
// Completing a request used to write only status, resolvedBy and resolvedAt:
// no export was produced and no erasure performed. An operator could mark an
// erasure request 'completed' while the subject's data stayed in full, leaving
// a durable record asserting a fulfilment that never happened -- worse than no
// record at all.
//
// What "completed" now means, by request type:
//
//   erasure        The subject's personal fields are anonymised in the same
//                  transaction that marks the request completed. Invoices,
//                  payments and ledger entries are kept: tax law requires them,
//                  and they reference the subject only by id once the name,
//                  phone, email, address and tax identifier are gone. Refused
//                  while a legal hold covers the subject.
//   access /       The export must have been generated first (GET .../export),
//   portability    which is audited with a hash and row counts. Completion is
//                  refused until that audit row exists. The export is never
//                  stored or returned through the idempotency layer, which
//                  would keep a copy of the subject's data for 24 hours.
//   rectification  These need a human decision -- the corrected values, or
//   / objection    whether the objection is upheld -- so completion requires a
//                  written resolution instead of implying automation.

import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';
import { isUnderLegalHold } from '@/lib/retention/legalHold';

type Tx = Prisma.TransactionClient;

type Subject = { type: 'customer' | 'supplier'; id: string };

async function loadOpenRequest(tx: Tx, companyId: string, requestId: string) {
  const request = await tx.dataSubjectRequest.findFirst({
    where: { id: requestId, companyId },
    select: { id: true, requestType: true, status: true, customerId: true, supplierId: true, details: true },
  });
  if (!request) throw new DomainError('RESOURCE_NOT_FOUND', 'DSR not found', {}, 404);
  if (request.status === 'completed' || request.status === 'rejected') {
    throw new DomainError('VALIDATION_FAILED', `DSR is already ${request.status}`, {}, 409);
  }
  return request;
}

function subjectOf(request: { customerId: string | null; supplierId: string | null }): Subject | null {
  if (request.customerId) return { type: 'customer', id: request.customerId };
  if (request.supplierId) return { type: 'supplier', id: request.supplierId };
  return null;
}

function requireSubject(request: { requestType: string; customerId: string | null; supplierId: string | null }): Subject {
  const subject = subjectOf(request);
  if (!subject) {
    throw new DomainError('VALIDATION_FAILED',
      `A ${request.requestType} request must name a customer or supplier`, {}, 409);
  }
  return subject;
}

/** Everything held about the subject, for an access or portability request. */
export async function buildSubjectExport(tx: Tx, companyId: string, requestId: string) {
  const request = await tx.dataSubjectRequest.findFirst({
    where: { id: requestId, companyId },
    select: { id: true, requestType: true, customerId: true, supplierId: true },
  });
  if (!request) throw new DomainError('RESOURCE_NOT_FOUND', 'DSR not found', {}, 404);
  if (request.requestType !== 'access' && request.requestType !== 'portability') {
    throw new DomainError('VALIDATION_FAILED', 'Only access and portability requests have an export', {}, 409);
  }
  const subject = requireSubject(request);
  const personal = { name: true, phone: true, email: true, address: true, taxIdentifier: true, createdAt: true } as const;

  const data = subject.type === 'customer'
    ? {
      subject: await tx.customer.findFirst({ where: { id: subject.id, companyId }, select: personal }),
      sales: await tx.sale.findMany({
        where: { companyId, customerId: subject.id },
        select: { referenceNo: true, businessDate: true, grandTotal: true, saleStatus: true },
        orderBy: { businessDate: 'asc' },
      }),
      payments: await tx.payment.findMany({
        where: { companyId, customerId: subject.id },
        select: { referenceNo: true, businessDate: true, amount: true, direction: true, paymentType: true, paymentStatus: true },
        orderBy: { businessDate: 'asc' },
      }),
    }
    : {
      subject: await tx.supplier.findFirst({ where: { id: subject.id, companyId }, select: personal }),
      purchases: await tx.purchase.findMany({
        where: { companyId, supplierId: subject.id },
        select: { referenceNo: true, orderDate: true, grandTotal: true, orderStatus: true },
        orderBy: { orderDate: 'asc' },
      }),
      payments: await tx.payment.findMany({
        where: { companyId, supplierId: subject.id },
        select: { referenceNo: true, businessDate: true, amount: true, direction: true, paymentType: true, paymentStatus: true },
        orderBy: { businessDate: 'asc' },
      }),
    };
  if (!data.subject) throw new DomainError('RESOURCE_NOT_FOUND', 'The subject of this request no longer exists', {}, 404);

  const document = {
    request_id: request.id,
    request_type: request.requestType,
    subject_type: subject.type,
    generated_at: new Date().toISOString(),
    data,
  };
  const serialised = JSON.stringify(document);
  const rowCounts = Object.fromEntries(Object.entries(data)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => [key, (value as unknown[]).length]));
  // The body served is exactly these bytes, so the recorded hash is one the
  // recipient can verify against what they received.
  return { document, serialised, sha256: createHash('sha256').update(serialised).digest('hex'), rowCounts };
}

/**
 * Carry out the request and mark it completed, in one transaction.
 * Returns a summary suitable for the response and the audit trail; never
 * personal data.
 */
export async function fulfilDataSubjectRequest(tx: Tx, params: {
  companyId: string;
  requestId: string;
  resolvedBy: string;
  resolutionNote?: string;
  correlationId: string;
}): Promise<{ requestType: string; outcome: string; detail: Record<string, unknown> }> {
  const request = await loadOpenRequest(tx, params.companyId, params.requestId);
  let outcome: string;
  let detail: Record<string, unknown>;

  switch (request.requestType) {
    case 'erasure': {
      const subject = requireSubject(request);
      if (await isUnderLegalHold(params.companyId, subject.type, subject.id)) {
        throw new DomainError('VALIDATION_FAILED',
          'An active legal hold covers this subject; the erasure request cannot be completed',
          { entity_type: subject.type, entity_id: subject.id }, 409);
      }
      const anonymised = {
        name: `[Erased ${subject.id.slice(-6)}]`,
        phone: null, email: null, address: null, taxIdentifier: null, isActive: false,
      };
      const updated = subject.type === 'customer'
        ? await tx.customer.updateMany({ where: { id: subject.id, companyId: params.companyId }, data: anonymised })
        : await tx.supplier.updateMany({ where: { id: subject.id, companyId: params.companyId }, data: anonymised });
      if (updated.count !== 1) throw new DomainError('RESOURCE_NOT_FOUND', 'The subject of this request no longer exists', {}, 404);
      outcome = 'anonymised';
      detail = {
        subject_type: subject.type,
        fields_erased: ['name', 'phone', 'email', 'address', 'taxIdentifier'],
        retained: 'financial records, referencing the subject by id only, as tax law requires',
      };
      break;
    }

    case 'access':
    case 'portability': {
      const exported = await tx.auditLog.findFirst({
        where: { companyId: params.companyId, action: 'dsr.export_generated', entityType: 'data_subject_request', entityId: request.id },
        select: { id: true, occurredAt: true },
        orderBy: { occurredAt: 'desc' },
      });
      if (!exported) {
        throw new DomainError('VALIDATION_FAILED',
          'Generate the export (GET /api/v1/data-subject-requests/{id}/export) before completing this request', {}, 409);
      }
      outcome = 'exported';
      detail = { export_audit_id: exported.id, exported_at: exported.occurredAt };
      break;
    }

    case 'rectification':
    case 'objection': {
      const note = params.resolutionNote?.trim();
      if (!note) {
        throw new DomainError('VALIDATION_FAILED',
          `A ${request.requestType} request needs a written resolution describing what was decided`, {}, 400);
      }
      outcome = 'resolved_manually';
      detail = { resolution_note: note };
      break;
    }

    default:
      throw new DomainError('VALIDATION_FAILED', `Unknown request type ${request.requestType}`, {}, 400);
  }

  const claimed = await tx.dataSubjectRequest.updateMany({
    where: { id: request.id, companyId: params.companyId, status: { notIn: ['completed', 'rejected'] } },
    data: {
      status: 'completed',
      resolvedBy: params.resolvedBy,
      resolvedAt: new Date(),
      details: JSON.stringify({ previous: request.details ?? null, outcome, ...detail }),
    },
  });
  if (claimed.count !== 1) throw new DomainError('CONCURRENT_MODIFICATION', 'DSR was resolved concurrently', {}, 409);

  await tx.auditLog.create({
    data: {
      companyId: params.companyId, userId: params.resolvedBy, correlationId: params.correlationId,
      action: 'dsr.completed', entityType: 'data_subject_request', entityId: request.id,
      afterValue: JSON.stringify({ request_type: request.requestType, outcome, ...detail }),
    },
  });

  return { requestType: request.requestType, outcome, detail };
}
