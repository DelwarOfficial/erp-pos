// Locking a fiscal period (disposable MariaDB, rolled back):
//   - the LATEST reconciliation run decides: an old failure no longer blocks
//     the lock once a later run has passed, and a latest failure still does;
//   - the lock is written through the caller's transaction, so it rolls back
//     with it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { lockPeriod } from '@/lib/accounting/periodClose';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const COMPANY_ID = 'd08293a4-b5c6-4d12-a345-6f708192a3b4';
const ROLLBACK = new Error('ROLLBACK_PERIOD');

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'PL', code: 'SYN-PL' });
}, 120_000);
afterAll(() => db.$disconnect());

async function probe(body: (tx: Prisma.TransactionClient) => Promise<void>) {
  try { await db.$transaction(async tx => { await body(tx); throw ROLLBACK; }, { timeout: 60_000 }); }
  catch (error) { if (error !== ROLLBACK) throw error; }
}

const period = (tx: Prisma.TransactionClient) => tx.fiscalPeriod.create({ data: { companyId: COMPANY_ID, periodName: `P-${Date.now()}-${Math.random()}`,
  periodStart: new Date('2001-01-01'), periodEnd: new Date('2001-01-31'), status: 'soft_locked' } });
const run = (tx: Prisma.TransactionClient, status: string, completedAt: string) => tx.reconciliationRun.create({ data: { companyId: COMPANY_ID, status, completedAt: new Date(completedAt) } });

describe('locking a period', () => {
  it('an old failed reconciliation no longer blocks once a later run passed', async () => {
    await probe(async tx => {
      await run(tx, 'failed', '2099-01-01T00:00:00Z');
      await run(tx, 'passed', '2099-01-02T00:00:00Z');
      const p = await period(tx);
      await lockPeriod(COMPANY_ID, p.id, 'tester', tx);
      expect((await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('locked');
    });
  });

  it('the latest run failing still blocks the lock', async () => {
    await probe(async tx => {
      await run(tx, 'passed', '2099-02-01T00:00:00Z');
      await run(tx, 'failed', '2099-02-02T00:00:00Z');
      const p = await period(tx);
      await expect(lockPeriod(COMPANY_ID, p.id, 'tester', tx)).rejects.toThrow(/critical findings/);
    });
  });
});
