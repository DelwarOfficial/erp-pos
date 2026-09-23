// F-38 regression: a permission check that throws a non-DomainError must fail
// closed. `requirePermission` reads the database, so a Prisma failure — pool
// exhaustion, lock-wait timeout, dropped connection — surfaces as something
// other than a DomainError. Before the fix these handlers caught it, discarded
// it, and continued with no authorization check at all.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DomainError } from '@/lib/errors/codes';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  permission: vi.fn(),
  scope: vi.fn(),
  tenant: vi.fn(),
  commit: vi.fn(),
  template: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: mocks.auth,
  requirePermission: mocks.permission,
  withAuthenticatedTenant: vi.fn(),
}));
vi.mock('@/lib/db/transaction', () => ({
  runInTenantContext: mocks.scope,
  withTenant: mocks.tenant,
  getTenantContext: () => ({ companyId: 'company-a' }),
  requireTenantContext: () => ({ companyId: 'company-a' }),
}));
vi.mock('@/lib/import-export/importProcessor', () => ({ commitImport: mocks.commit }));
vi.mock('@/lib/import-export/templates', () => ({ getTemplate: mocks.template }));

import { GET as approvalsGet, POST as approvalsPost } from '@/app/api/v1/approvals/route';
import { POST as importCommit } from '@/app/api/v1/import-jobs/[id]/commit/route';

const AUTH = {
  companyId: 'company-a',
  userId: 'user-a',
  // The dead `!auth.isGlobal` conjunct made the swallow conditional on this
  // flag. A plain tenant user (isGlobal: false) still hit it, because the
  // thrown value was not a DomainError.
  isGlobal: false,
  branchIds: ['branch-a'],
  accessScope: 'branch',
  ctx: { companyId: 'company-a' },
};

/** What a Prisma failure inside the permission lookup looks like: not a DomainError. */
function databaseFailure(): Error {
  const error = new Error('Timed out fetching a new connection from the connection pool');
  (error as { code?: string }).code = 'P2024';
  return error;
}

describe('permission checks fail closed when the check itself errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(AUTH);
    mocks.scope.mockImplementation(async (_ctx: unknown, work: () => Promise<unknown>) => work());
    mocks.tenant.mockImplementation(async (_ctx: unknown, work: (tx: unknown) => Promise<unknown>) => work({}));
    mocks.template.mockReturnValue({ jobType: 'products' });
  });

  /**
   * A handler fails closed if it either propagates the error or converts it to
   * a 5xx through its own error handler. What it must never do is return a
   * success after skipping the check. Both shapes exist in these routes, so the
   * assertion is on the outcome, not on which of the two happened.
   */
  async function assertFailedClosed(run: () => Promise<Response>) {
    let response: Response | undefined;
    try {
      response = await run();
    } catch {
      return; // propagated — fail closed
    }
    expect(response!.status).toBeGreaterThanOrEqual(500);
  }

  it('GET /approvals does not reach the handler body when the permission lookup throws', async () => {
    mocks.permission.mockRejectedValue(databaseFailure());
    await assertFailedClosed(() =>
      approvalsGet(new NextRequest('http://localhost/api/v1/approvals', { method: 'GET' })));
    expect(mocks.scope).not.toHaveBeenCalled();
  });

  it('POST /approvals does not reach the handler body when the permission lookup throws', async () => {
    mocks.permission.mockRejectedValue(databaseFailure());
    await assertFailedClosed(() =>
      approvalsPost(new NextRequest('http://localhost/api/v1/approvals', {
        method: 'POST',
        headers: { 'idempotency-key': 'k'.repeat(16), 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })));
    expect(mocks.scope).not.toHaveBeenCalled();
    expect(mocks.tenant).not.toHaveBeenCalled();
  });

  it('POST /import-jobs/[id]/commit does not import when the permission lookup throws', async () => {
    mocks.permission.mockRejectedValue(databaseFailure());
    await expect(
      importCommit(
        new NextRequest('http://localhost/api/v1/import-jobs/job-1/commit', {
          method: 'POST',
          headers: { 'idempotency-key': 'k'.repeat(16), 'content-type': 'application/json' },
          body: JSON.stringify({ csvContent: 'code,name\nP1,Widget\n' }),
        }),
        { params: Promise.resolve({ id: 'job-1' }) },
      ),
    ).rejects.toThrow(/connection pool/);
    // The decisive assertion: no rows are imported when authorization never ran.
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('still returns the DomainError status when the permission is genuinely denied', async () => {
    mocks.permission.mockRejectedValue(new DomainError('FORBIDDEN_SCOPE', 'Missing permission', {}, 403));
    const response = await importCommit(
      new NextRequest('http://localhost/api/v1/import-jobs/job-1/commit', {
        method: 'POST',
        headers: { 'idempotency-key': 'k'.repeat(16), 'content-type': 'application/json' },
        body: JSON.stringify({ csvContent: 'code,name\nP1,Widget\n' }),
      }),
      { params: Promise.resolve({ id: 'job-1' }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
