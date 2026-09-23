// F-37 / F-43 regression: an offline batch must actually be applied, and the
// payload hash must be recomputed rather than taken on trust.
//
// Before the fix a `cash_sale` command was written to offline_commands with
// status 'synced' and never executed. No sale, payment, stock movement or
// journal existed, and the response reported synced_count for the whole batch.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  permission: vi.fn(),
  scope: vi.fn(),
  tenant: vi.fn(),
  idempotency: vi.fn(),
  deviceFindFirst: vi.fn(),
  batchCreate: vi.fn(),
  batchUpdate: vi.fn(),
  commandFindFirst: vi.fn(),
  commandCreate: vi.fn(),
  auditCreate: vi.fn(),
  postSale: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: mocks.auth,
  requirePermission: mocks.permission,
}));
vi.mock('@/lib/db/transaction', () => ({
  runInTenantContext: mocks.scope,
  withTenant: mocks.tenant,
}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/idempotency', () => ({
  withIdempotency: mocks.idempotency,
  computeRequestHash: () => 'hash',
  requireIdempotencyKey: () => 'k'.repeat(16),
}));
vi.mock('@/domain/commands/m3/PostSale', () => ({ postSale: mocks.postSale }));

import { POST as syncRoute } from '@/app/api/v1/offline/sync/route';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const AUTH = {
  companyId: 'company-a', userId: 'user-a', isGlobal: false,
  branchIds: ['branch-a'], ctx: { companyId: 'company-a' },
};

const SALE_PAYLOAD = {
  branch_id: '22222222-2222-4222-8222-222222222222',
  warehouse_id: '33333333-3333-4333-8333-333333333333',
  currency_code: 'BDT',
  exchange_rate: 1,
  business_date: '2026-09-20T10:00:00.000Z',
  items: [{ product_id: '44444444-4444-4444-8444-444444444444', qty: 2, unit_price: 150 }],
  payments: [{ payment_method: 'cash', amount: 300, financial_account_id: '55555555-5555-4555-8555-555555555555' }],
};

function hashOf(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function request(commands: unknown[]) {
  return new NextRequest('http://localhost/api/v1/offline/sync', {
    method: 'POST',
    headers: { 'idempotency-key': 'k'.repeat(16), 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: DEVICE_ID, commands }),
  });
}

describe('offline sync applies the commands it accepts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(AUTH);
    mocks.permission.mockResolvedValue(undefined);
    mocks.scope.mockImplementation(async (_ctx: unknown, work: () => Promise<unknown>) => work());
    mocks.idempotency.mockImplementation(async (_p: unknown, work: () => Promise<{ status: number; body: unknown }>) => {
      const result = await work();
      return { ...result, isReplay: false };
    });
    mocks.tenant.mockImplementation(async (_ctx: unknown, work: (tx: unknown) => Promise<unknown>) => work({
      device: { findFirst: mocks.deviceFindFirst },
      offlineSyncBatch: { create: mocks.batchCreate, update: mocks.batchUpdate },
      offlineCommand: { findFirst: mocks.commandFindFirst, create: mocks.commandCreate },
      auditLog: { create: mocks.auditCreate },
    }));
    mocks.deviceFindFirst.mockResolvedValue({ id: DEVICE_ID, companyId: 'company-a', status: 'active' });
    mocks.batchCreate.mockResolvedValue({ id: 'batch-1' });
    mocks.batchUpdate.mockResolvedValue({});
    mocks.commandFindFirst.mockResolvedValue(null);
    mocks.commandCreate.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
    mocks.postSale.mockResolvedValue({ saleId: 'sale-1', referenceNo: 'INV-000001' });
  });

  it('posts an offline cash sale through the same command the online path uses', async () => {
    const response = await syncRoute(request([{
      command_type: 'cash_sale',
      sequence_number: 1,
      payload: SALE_PAYLOAD,
      payload_hash: hashOf(SALE_PAYLOAD),
      idempotency_key: 'c'.repeat(16),
    }]));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied_count).toBe(1);
    expect(body.results[0]).toMatchObject({ status: 'applied', resource_id: 'sale-1' });

    // The decisive assertion: the sale was actually posted.
    expect(mocks.postSale).toHaveBeenCalledTimes(1);
    const posted = mocks.postSale.mock.calls[0][1];
    expect(posted).toMatchObject({ companyId: 'company-a', cashierId: 'user-a' });
    expect(posted.items).toHaveLength(1);
    // The terminal's capture time is preserved, so the sale lands in the
    // period it happened in rather than the period it was uploaded in.
    expect(posted.businessDate.toISOString()).toBe('2026-09-20T10:00:00.000Z');
    expect(mocks.commandCreate).toHaveBeenCalledTimes(1);
    expect(mocks.commandCreate.mock.calls[0][0].data.status).toBe('applied');
  });

  it('rejects a batch whose payload hash does not match the payload', async () => {
    await expect(syncRoute(request([{
      command_type: 'cash_sale',
      sequence_number: 1,
      payload: SALE_PAYLOAD,
      payload_hash: 'f'.repeat(64), // client's claim, not the real hash
      idempotency_key: 'c'.repeat(16),
    }]))).resolves.toMatchObject({ status: 400 });

    expect(mocks.postSale).not.toHaveBeenCalled();
    expect(mocks.commandCreate).not.toHaveBeenCalled();
  });

  it('rejects a cash sale whose payload is not a valid sale', async () => {
    const malformed = { branch_id: 'not-a-uuid' };
    const response = await syncRoute(request([{
      command_type: 'cash_sale',
      sequence_number: 1,
      payload: malformed,
      payload_hash: hashOf(malformed),
      idempotency_key: 'c'.repeat(16),
    }]));

    expect(response.status).toBe(400);
    expect(mocks.postSale).not.toHaveBeenCalled();
  });

  it('records a command with no posting effect as stored, not applied', async () => {
    const payload = { note: 'parked' };
    const response = await syncRoute(request([{
      command_type: 'held_sale_draft',
      sequence_number: 1,
      payload,
      payload_hash: hashOf(payload),
      idempotency_key: 'c'.repeat(16),
    }]));

    const body = await response.json();
    expect(body.applied_count).toBe(0);
    expect(body.results[0]).toMatchObject({ status: 'stored' });
    expect(mocks.postSale).not.toHaveBeenCalled();
  });

  it('requires a write permission rather than device.read', async () => {
    await syncRoute(request([{
      command_type: 'held_sale_draft',
      sequence_number: 1,
      payload: {},
      payload_hash: hashOf({}),
      idempotency_key: 'c'.repeat(16),
    }]));
    expect(mocks.permission).toHaveBeenCalledWith(AUTH, 'sale.post');
  });
});
