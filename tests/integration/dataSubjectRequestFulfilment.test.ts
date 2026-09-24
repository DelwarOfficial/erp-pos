// F-57 regression: completing a data-subject request must carry it out.
//
// Completion used to write only status, resolvedBy and resolvedAt. No export
// was produced and no erasure performed, so an erasure request could be
// recorded as fulfilled while every field of the subject's data remained.
//
// Runs against the real MariaDB in transactions that roll back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { buildSubjectExport, fulfilDataSubjectRequest } from '@/lib/compliance/dataSubjectRequests';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const COMPANY_ID = '8b3d0e51-6f72-4c83-9d94-2e5f6a7b8c9d';
const ROLLBACK = new Error('ROLLBACK_DSR_PROBE');
let userId: string;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318'
    || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  const fixture = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'DSR', code: 'SYN-DSR' });
  userId = fixture.user.id;
});
afterAll(() => db.$disconnect());

async function probe(body: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await db.$transaction(async tx => { await body(tx); throw ROLLBACK; }, { timeout: 30000 });
  } catch (error) { if (error !== ROLLBACK) throw error; }
}

async function customerWithRequest(tx: Prisma.TransactionClient, requestType: string) {
  const customer = await tx.customer.create({
    data: {
      companyId: COMPANY_ID, name: 'Rahim Uddin', phone: '+8801700000000',
      email: 'rahim@example.invalid', address: '12 Road, Rangpur', taxIdentifier: 'TIN-123456',
    },
  });
  const request = await tx.dataSubjectRequest.create({
    data: { companyId: COMPANY_ID, requestType, customerId: customer.id, status: 'open' },
  });
  return { customer, request };
}

function fulfil(tx: Prisma.TransactionClient, requestId: string, resolutionNote?: string) {
  return fulfilDataSubjectRequest(tx, {
    companyId: COMPANY_ID, requestId, resolvedBy: userId, resolutionNote, correlationId: randomUUID(),
  });
}

describe('erasure', () => {
  it('anonymises the subject in the same transaction that marks it completed', async () => {
    await probe(async tx => {
      const { customer, request } = await customerWithRequest(tx, 'erasure');

      const result = await fulfil(tx, request.id);

      const after = await tx.customer.findUniqueOrThrow({ where: { id: customer.id } });
      // The decisive assertions: before the fix every one of these survived.
      expect(after.name).not.toBe('Rahim Uddin');
      expect(after.phone).toBeNull();
      expect(after.email).toBeNull();
      expect(after.address).toBeNull();
      expect(after.taxIdentifier).toBeNull();
      expect(result.outcome).toBe('anonymised');

      const stored = await tx.dataSubjectRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(stored.status).toBe('completed');
      expect(stored.resolvedBy).toBe(userId);
    });
  });

  it('refuses while a legal hold covers the subject, and changes nothing', async () => {
    // isUnderLegalHold reads through systemDb, outside this transaction, so the
    // hold is committed for the probe and removed afterwards.
    const customer = await db.customer.create({
      data: { companyId: COMPANY_ID, name: 'Held Customer', phone: '+8801711111111' },
    });
    const hold = await db.legalHold.create({
      data: { companyId: COMPANY_ID, entityType: 'customer', entityId: customer.id, reason: 'probe', declaredBy: userId },
    });
    try {
      await probe(async tx => {
        const request = await tx.dataSubjectRequest.create({
          data: { companyId: COMPANY_ID, requestType: 'erasure', customerId: customer.id, status: 'open' },
        });
        await expect(fulfil(tx, request.id)).rejects.toMatchObject({ httpStatus: 409 });
        const after = await tx.customer.findUniqueOrThrow({ where: { id: customer.id } });
        expect(after.phone).toBe('+8801711111111');
      });
    } finally {
      await db.legalHold.update({ where: { id: hold.id }, data: { releasedAt: new Date() } });
    }
  });
});

describe('access and portability', () => {
  it('refuses completion until the export has been generated', async () => {
    await probe(async tx => {
      const { request } = await customerWithRequest(tx, 'access');
      await expect(fulfil(tx, request.id)).rejects.toMatchObject({ httpStatus: 409 });
    });
  });

  it('produces an export whose hash is of the exact bytes served', async () => {
    await probe(async tx => {
      const { request } = await customerWithRequest(tx, 'portability');
      const built = await buildSubjectExport(tx, COMPANY_ID, request.id);

      expect(built.document.data.subject).toMatchObject({ name: 'Rahim Uddin', email: 'rahim@example.invalid' });
      expect(createHash('sha256').update(built.serialised).digest('hex')).toBe(built.sha256);
    });
  });

  it('completes once the export is on record', async () => {
    await probe(async tx => {
      const { request } = await customerWithRequest(tx, 'access');
      await tx.auditLog.create({
        data: {
          companyId: COMPANY_ID, userId, correlationId: randomUUID(),
          action: 'dsr.export_generated', entityType: 'data_subject_request', entityId: request.id,
          afterValue: '{}',
        },
      });
      await expect(fulfil(tx, request.id)).resolves.toMatchObject({ outcome: 'exported' });
    });
  });
});

describe('rectification and objection', () => {
  it('requires a written resolution rather than implying automation', async () => {
    await probe(async tx => {
      const { request } = await customerWithRequest(tx, 'rectification');
      await expect(fulfil(tx, request.id)).rejects.toMatchObject({ httpStatus: 400 });
      await expect(fulfil(tx, request.id, 'Corrected phone number per customer email of 2026-09-20'))
        .resolves.toMatchObject({ outcome: 'resolved_manually' });
    });
  });
});

describe('state', () => {
  it('cannot complete a request twice', async () => {
    await probe(async tx => {
      const { request } = await customerWithRequest(tx, 'erasure');
      await fulfil(tx, request.id);
      await expect(fulfil(tx, request.id)).rejects.toMatchObject({ httpStatus: 409 });
    });
  });
});
