// F-42 / F-49 regression.
//
// F-42  The import commit took the CSV from the request body at commit time
//       rather than the file that was validated, so validation was decorative:
//       validate one file, commit another. And the job-status check was a
//       read-then-act with nothing claiming the job, so two concurrent commits
//       both saw 'ready' and both imported, doubling every row.
// F-49  A missing Idempotency-Key threw out of the handler before its try, so
//       the client got an unhandled 500 instead of the documented 400.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  jobFindFirst: vi.fn(),
  jobUpdateMany: vi.fn(),
  jobUpdate: vi.fn(),
  productFindFirst: vi.fn(),
  productCreate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    importJob: { findFirst: mocks.jobFindFirst, updateMany: mocks.jobUpdateMany, update: mocks.jobUpdate },
    product: { findFirst: mocks.productFindFirst, create: mocks.productCreate },
  },
}));

import { commitImport } from '@/lib/import-export/importProcessor';

const VALIDATED = 'code,name\nP1,Widget\n';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const TEMPLATE = { jobType: 'product', columns: [] } as never;

describe('F-42: commit is bound to the validated file and to one caller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jobFindFirst.mockResolvedValue({ fileSha256: sha(VALIDATED) });
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.jobUpdate.mockResolvedValue({});
  });

  it('refuses content that differs from the validated file', async () => {
    const substituted = 'code,name\nP1,Widget\nEVIL,Injected row\n';

    await expect(commitImport('job-1', 'company-a', 'user-a', substituted, TEMPLATE, 'skip'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', httpStatus: 409 });

    // The decisive assertions: the job is not claimed and nothing is written.
    expect(mocks.jobUpdateMany).not.toHaveBeenCalled();
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });

  it('refuses a job that was never hashed', async () => {
    mocks.jobFindFirst.mockResolvedValue({ fileSha256: null });
    await expect(commitImport('job-1', 'company-a', 'user-a', VALIDATED, TEMPLATE, 'skip'))
      .rejects.toMatchObject({ httpStatus: 409 });
    expect(mocks.jobUpdateMany).not.toHaveBeenCalled();
  });

  it('claims the job with a conditional update from ready to importing', async () => {
    await commitImport('job-1', 'company-a', 'user-a', VALIDATED, TEMPLATE, 'skip').catch(() => undefined);

    expect(mocks.jobUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.jobUpdateMany.mock.calls[0][0]).toEqual({
      where: { id: 'job-1', companyId: 'company-a', status: 'ready' },
      data: { status: 'importing' },
    });
  });

  it('refuses the second of two concurrent commits before any row is written', async () => {
    // The other request already moved the job out of 'ready'.
    mocks.jobUpdateMany.mockResolvedValue({ count: 0 });

    await expect(commitImport('job-1', 'company-a', 'user-a', VALIDATED, TEMPLATE, 'skip'))
      .rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION', httpStatus: 409 });
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });

  it('scopes the job lookup to the caller company', async () => {
    await commitImport('job-1', 'company-a', 'user-a', VALIDATED, TEMPLATE, 'skip').catch(() => undefined);
    expect(mocks.jobFindFirst.mock.calls[0][0].where).toEqual({ id: 'job-1', companyId: 'company-a' });
  });
});

describe('F-49: a missing Idempotency-Key is a 400, not an unhandled 500', () => {
  it('returns 400 from the commit route', async () => {
    vi.resetModules();
    vi.doMock('@/lib/auth/middleware', () => ({
      authenticateRequest: vi.fn(), requirePermission: vi.fn(),
    }));
    const { POST } = await import('@/app/api/v1/import-jobs/[id]/commit/route');

    const response = await POST(
      new NextRequest('http://localhost/api/v1/import-jobs/job-1/commit', { method: 'POST' }),
      { params: Promise.resolve({ id: 'job-1' }) },
    );

    expect(response.status).toBe(400);
  });
});
