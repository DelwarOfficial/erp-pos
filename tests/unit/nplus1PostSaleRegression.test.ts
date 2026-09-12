import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('@/lib/numbering', () => ({
  nextDocumentNumber: vi.fn(async () => ({ documentNumber: 'SAFE-PROOF', sequenceValue: 1 })),
}));
vi.mock('@/domain/inventory/stockMovement', () => ({
  postStockMovement: vi.fn(async () => ({ movementId: 'movement-safe' })),
  validateSerialTransition: vi.fn(),
}));
vi.mock('@/domain/commands/m4/PostJournalEntry', () => ({
  postJournalEntry: vi.fn(async () => ({ journalEntryId: 'journal-safe' })),
}));

import { postSale } from '@/domain/commands/m3/PostSale';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';

describe('sale-posting N+1 regression', () => {
  beforeEach(() => vi.clearAllMocks());
  for (const [currencyCode, exchangeRate] of [['BDT', 1], ['USD', 120]] as const) {
  for (const size of [1, 10, 100]) {
    it(`measures reads and base-currency posting for ${currencyCode}, N=${size}`, async () => {
      const productRead = vi.fn(async ({ where }: any) => where.id.in.map((id: string) => ({
        id,
        name: 'Safe product',
        code: 'SAFE',
        unit: { code: 'EA' },
        defaultTaxCode: null,
        productType: 'standard',
        isSerialized: false,
        warrantyPeriodMonths: null,
      })));
      const stockRead = vi.fn(async ({ where }: any) => where.productId.in.map((productId: string) => ({
        productId,
        movingAverageCost: { toString: () => '10' },
      })));
      const financialAccountRead = vi.fn(async ({ where }: any) => where.id.in.map((id: string) => ({
        id,
        chartOfAccountId: 'cash-account',
        isActive: true,
        currencyCode,
      })));
      let saleItemSequence = 0;
      const tx = {
        cashierShift: { findFirst: vi.fn() },
        warehouse: { findFirst: vi.fn(async () => ({ id: 'warehouse-a' })) },
        businessEvent: { create: vi.fn(async () => ({})) },
        product: { findMany: productRead },
        warehouseStock: { findMany: stockRead },
        sale: { create: vi.fn(async () => ({ id: 'sale-safe' })) },
        saleItem: { create: vi.fn(async () => ({ id: `sale-item-${saleItemSequence++}` })) },
        saleItemTax: { create: vi.fn(async () => ({})) },
        saleItemSerial: { create: vi.fn(async () => ({})) },
        productSerial: { findMany: vi.fn(async () => []), findUnique: vi.fn(), update: vi.fn() },
        serialEvent: { create: vi.fn() },
        payment: { create: vi.fn(async () => ({ id: 'payment-safe' })) },
        paymentAllocation: { create: vi.fn(async () => ({})) },
        accountingPolicy: { findUnique: vi.fn(async () => ({
          arAccountId: 'ar-account',
          salesRevenueAccountId: 'sales-account',
          cogsAccountId: 'cogs-account',
          inventoryAccountId: 'inventory-account',
        })) },
        financialAccount: { findMany: financialAccountRead },
        auditLog: { create: vi.fn(async () => ({})) },
      } as any;
      const items = Array.from({ length: size }, (_, i) => ({
        productId: `product-${i}`,
        qty: 1,
        unitPrice: 10,
      }));
      const payments = Array.from({ length: size }, (_, i) => ({
        paymentMethod: 'cash',
        amount: 10,
        financialAccountId: `financial-account-${i}`,
      }));

      const result = await postSale(tx, {
        companyId: 'tenant-a',
        branchId: 'branch-a',
        warehouseId: 'warehouse-a',
        cashierId: 'user-a',
        currencyCode,
        exchangeRate,
        businessDate: new Date('2026-01-01T00:00:00Z'),
        items,
        payments,
      }, 'safe-proof');

      console.info('PHASE_A_POST_SALE_READS', {
        size,
        productReads: productRead.mock.calls.length,
        stockReads: stockRead.mock.calls.length,
        financialAccountReads: financialAccountRead.mock.calls.length,
      });
      expect(productRead).toHaveBeenCalledTimes(1);
      expect(stockRead).toHaveBeenCalledTimes(1);
      expect(financialAccountRead).toHaveBeenCalledTimes(1);
      expect(productRead.mock.calls[0][0].where.companyId).toBe('tenant-a');
      expect(stockRead.mock.calls[0][0].where.companyId).toBe('tenant-a');
      expect(financialAccountRead.mock.calls[0][0].where.companyId).toBe('tenant-a');
      expect(result.baseGrandTotal).toBe(String(size * 10 * exchangeRate));
      const journals = vi.mocked(postJournalEntry).mock.calls.map(call => call[1]);
      const revenue = journals.find(journal => journal.postingKind === 'sale_revenue')!;
      const cogs = journals.find(journal => journal.postingKind === 'sale_cogs')!;
      const totalDebit = (journal: typeof revenue) => journal.lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0)).toString();
      expect(totalDebit(revenue)).toBe(result.baseGrandTotal);
      expect(totalDebit(cogs)).toBe(String(size * 10)); // Never convert base COGS twice.
    });
  }
  }

  it('rejects a product ID that the tenant-scoped preload cannot resolve', async () => {
    const productRead = vi.fn(async (_args: { where: { companyId: string } }) => []);
    const tx = {
      warehouse: { findFirst: vi.fn(async () => ({ id: 'warehouse-a' })) },
      businessEvent: { create: vi.fn(async () => ({})) },
      product: { findMany: productRead },
      warehouseStock: { findMany: vi.fn(async () => []) },
      productSerial: { findMany: vi.fn(async () => []) },
    } as any;

    await expect(postSale(tx, {
      companyId: 'tenant-a',
      branchId: 'branch-a',
      warehouseId: 'warehouse-a',
      cashierId: 'user-a',
      currencyCode: 'BDT',
      exchangeRate: 1,
      businessDate: new Date('2026-01-01T00:00:00Z'),
      items: [{ productId: 'product-from-tenant-b', qty: 1, unitPrice: 10 }],
      payments: [],
    }, 'safe-proof')).rejects.toThrow(/not found or inactive/);
    expect(productRead.mock.calls[0][0].where.companyId).toBe('tenant-a');
  });
});
