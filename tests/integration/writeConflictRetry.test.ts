// F-35: a unit of work aborted by a write conflict is run again; one that
// keeps conflicting is reported as a retryable 409, and other errors are not retried.
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant, WRITE_CONFLICT_ATTEMPTS } from '@/lib/db/transaction';

const ctx = () => ({ companyId: randomUUID(), branchIds: [], allBranches: true, isGlobal: false, userId: undefined, correlationId: randomUUID(), requestId: randomUUID() }) as never;
const conflict = () => Object.assign(new Error('Deadlock found when trying to get lock; try restarting transaction (1213)'), { code: 'P2034' });

describe('withTenant write-conflict retry', () => {
  it('runs the work again after a conflict and returns its result', async () => {
    let runs = 0;
    const result = await withTenant(ctx(), async () => { runs++; if (runs === 1) throw conflict(); return 'done'; });
    expect(result).toBe('done');
    expect(runs).toBe(2);
  });

  it('gives up after the last attempt with a retryable 409', async () => {
    let runs = 0;
    await expect(withTenant(ctx(), async () => { runs++; throw conflict(); }))
      .rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION', httpStatus: 409 });
    expect(runs).toBe(WRITE_CONFLICT_ATTEMPTS);
  });

  it('does not retry other errors', async () => {
    let runs = 0;
    await expect(withTenant(ctx(), async () => { runs++; throw new Error('validation'); })).rejects.toThrow('validation');
    expect(runs).toBe(1);
  });
});
