// F-40 / F-41 regression.
//
// F-40  A failed attempt's stored response was replayed on retry, so one
//       transient error poisoned the key for its 24-hour TTL: the client
//       retried with the same key, as ADR 0004 requires, and got the cached
//       500 back every time.
// F-41  82 of 83 call sites wrote the idempotency reservation on the autocommit
//       client beside the business transaction. Three separate commits meant a
//       crash after the work committed left the key stuck at 'processing' for
//       24 hours although the work had succeeded.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  securityEvent: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    idempotencyRequest: {
      create: mocks.create, findFirst: mocks.findFirst,
      update: mocks.update, updateMany: mocks.updateMany,
    },
  },
}));
vi.mock('@/lib/db/transaction', () => ({ getTenantContext: () => ({ companyId: 'company-a' }) }));
vi.mock('@/lib/audit', () => ({ recordSecurityEvent: mocks.securityEvent }));

import { withIdempotency } from '@/lib/idempotency';

const PARAMS = {
  idempotencyKey: 'k'.repeat(16), operation: 'sale.post',
  requestHash: 'hash-1', companyId: 'company-a', userId: 'user-a',
};

function duplicateKey(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

describe('F-40: a failed attempt is retried, not replayed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockRejectedValue(duplicateKey());
    mocks.update.mockResolvedValue({});
  });

  it('runs the work again when the stored attempt failed', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'row-1', companyId: 'company-a', requestHash: 'hash-1',
      status: 'failed', responseStatus: 500, responseBody: '{"error":{"code":"INTERNAL_ERROR"}}',
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const work = vi.fn().mockResolvedValue({ status: 201, body: { id: 'sale-1' } });

    const result = await withIdempotency(PARAMS, work);

    // The decisive assertions: the work ran, and the cached 500 was not returned.
    expect(work).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 201, body: { id: 'sale-1' }, isReplay: false });
    // The reclaim is conditional, so only one concurrent retry can win it.
    expect(mocks.updateMany.mock.calls[0][0].where).toEqual({ id: 'row-1', status: 'failed' });
  });

  it('tells a concurrent retry the key is in flight when it loses the reclaim', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'row-1', companyId: 'company-a', requestHash: 'hash-1', status: 'failed',
    });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const work = vi.fn();

    await expect(withIdempotency(PARAMS, work)).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
    expect(work).not.toHaveBeenCalled();
  });

  it('still replays a success without running the work', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'row-1', companyId: 'company-a', requestHash: 'hash-1',
      status: 'succeeded', responseStatus: 201, responseBody: '{"id":"sale-1"}',
    });
    const work = vi.fn();

    const result = await withIdempotency(PARAMS, work);

    expect(work).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 201, body: { id: 'sale-1' }, isReplay: true });
  });

  it('still refuses a key reused with a different body', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'row-1', companyId: 'company-a', requestHash: 'other-hash', status: 'failed',
    });
    await expect(withIdempotency(PARAMS, vi.fn())).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe('F-41: every reservation is written by the business transaction', () => {
  const root = path.resolve('src/app');
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter(file => file.endsWith('.ts'))
    .map(file => path.join(root, file));

  const calls: Array<{ file: string; line: number; args: number }> = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'withIdempotency') {
        calls.push({
          file: path.relative(process.cwd(), file).replaceAll('\\', '/'),
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          args: node.arguments.length,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  it('finds the call sites it is guarding', () => {
    // A guard that silently matches nothing proves nothing.
    expect(calls.length).toBeGreaterThanOrEqual(80);
  });

  it('passes the transaction client at every call site', () => {
    // Without the third argument the reservation is committed on its own,
    // before the business work, and a crash between the two strands the key.
    const split = calls.filter(call => call.args < 3).map(call => `${call.file}:${call.line}`);
    expect(split, `non-atomic idempotency reservations:\n${split.join('\n')}`).toEqual([]);
  });
});
