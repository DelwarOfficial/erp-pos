import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ tx: null as any }));

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: vi.fn(async () => ({
    ctx: { companyId: 'tenant-a' }, companyId: 'tenant-a', userId: 'user-a',
  })),
  requirePermission: vi.fn(async () => undefined),
}));
vi.mock('@/lib/db/transaction', () => ({
  runInTenantContext: vi.fn(async (_ctx: unknown, work: () => Promise<unknown>) => work()),
  withTenant: vi.fn(async (_ctx: unknown, work: (tx: unknown) => Promise<unknown>) => work(state.tx)),
}));
vi.mock('@/lib/idempotency', () => ({
  withIdempotency: vi.fn(async (_params: unknown, work: () => Promise<unknown>) => work()),
  computeRequestHash: vi.fn(() => 'safe-hash'),
  requireIdempotencyKey: vi.fn(() => 'safe-key'),
}));
vi.mock('@/lib/numbering', () => ({
  nextDocumentNumber: vi.fn(async () => ({ documentNumber: 'SAFE-PROOF', sequenceValue: 1 })),
}));

import { POST as createPurchase } from '@/app/api/v1/purchases/route';
import { POST as createQuotation } from '@/app/api/v1/quotations/route';

const request = (body: unknown) => new Request('http://local.test/api', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}) as any;

describe('document-route N+1 regression', () => {
  beforeEach(() => { state.tx = null; });

  for (const size of [1, 10, 100]) {
    it(`measures purchase product reads for N=${size}`, async () => {
      const productRead = vi.fn(async ({ where }: any) => where.id.in.map((id: string) => ({ id, name: 'Safe', code: 'SAFE' })));
      state.tx = {
        supplier: { findFirst: vi.fn(async () => ({ name: 'Supplier' })) },
        branch: { findFirst: vi.fn(async () => ({ id: 'branch-a' })) },
        warehouse: { findFirst: vi.fn(async () => ({ id: 'warehouse-a' })) },
        purchase: { create: vi.fn(async () => ({ id: 'purchase-a' })) },
        product: { findMany: productRead },
        purchaseItem: { create: vi.fn(async () => ({})) },
        auditLog: { create: vi.fn(async () => ({})) },
      };
      const response = await createPurchase(request({
        branch_id: '00000000-0000-4000-8000-000000000001',
        warehouse_id: '00000000-0000-4000-8000-000000000002',
        supplier_id: '00000000-0000-4000-8000-000000000003',
        order_date: '2026-01-01T00:00:00.000Z',
        items: Array.from({ length: size }, (_, i) => ({
          product_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          qty_ordered: 1, unit_cost: 1,
        })),
      }));
      expect(response.status).toBe(201);
      console.info('PHASE_A_PURCHASE_PRODUCT_READS', { size, reads: productRead.mock.calls.length });
      expect(productRead).toHaveBeenCalledTimes(1);
      expect(productRead.mock.calls[0][0].where.companyId).toBe('tenant-a');
    });

    it(`measures quotation product reads for N=${size}`, async () => {
      const productRead = vi.fn(async ({ where }: any) => where.id.in.map((id: string) => ({ id, name: 'Safe', code: 'SAFE' })));
      state.tx = {
        product: { findMany: productRead },
        quotation: { create: vi.fn(async () => ({ id: 'quotation-a', status: 'draft' })) },
        quotationItem: { create: vi.fn(async () => ({})) },
        auditLog: { create: vi.fn(async () => ({})) },
      };
      const response = await createQuotation(request({
        branch_id: '00000000-0000-4000-8000-000000000001',
        items: Array.from({ length: size }, (_, i) => ({
          product_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          qty: 1, unit_price: 1,
        })),
      }));
      expect(response.status).toBe(201);
      console.info('PHASE_A_QUOTATION_PRODUCT_READS', { size, reads: productRead.mock.calls.length });
      expect(productRead).toHaveBeenCalledTimes(1);
      expect(productRead.mock.calls[0][0].where.companyId).toBe('tenant-a');
    });
  }
});
