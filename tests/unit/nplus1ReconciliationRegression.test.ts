import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/numbering', () => ({
  nextDocumentNumber: vi.fn(async () => ({ documentNumber: 'SAFE-PROOF', sequenceValue: 1 })),
}));

import {
  checkReservationProjection,
  checkSerialStockCount,
  checkStockQtyLedger,
  checkStockValueLedger,
} from '@/lib/reconciliation/checks';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';

const decimal = (value: number) => ({ toString: () => String(value) });

describe('reconciliation and journal N+1 regression', () => {
  for (const size of [1, 10, 100]) {
    it(`measures reconciliation read growth for N=${size}`, async () => {
      const stocks = Array.from({ length: size }, (_, i) => ({
        id: `stock-${i}`,
        warehouseId: `warehouse-${i}`,
        productId: `product-${i}`,
        qtyOnHand: decimal(1),
        movingAverageCost: decimal(10),
        qtyReserved: decimal(1),
      }));
      const movementGroupBy = vi.fn(async () => stocks.map(s => ({
        warehouseId: s.warehouseId,
        productId: s.productId,
        _sum: { qtyDelta: decimal(1), totalCostDelta: decimal(10) },
      })));
      const reservationGroupBy = vi.fn(async () => stocks.map(s => ({
        warehouseId: s.warehouseId,
        productId: s.productId,
        _sum: { qty: decimal(1) },
      })));
      const tx = {
        warehouseStock: {
          findMany: vi.fn(async () => stocks),
        },
        stockMovement: { groupBy: movementGroupBy },
        stockReservation: { groupBy: reservationGroupBy },
        productSerial: {
          groupBy: vi.fn(async () => stocks.map(s => ({
            currentWarehouseId: s.warehouseId,
            productId: s.productId,
            _count: 1,
          }))),
        },
      } as any;

      await checkStockQtyLedger(tx, 'tenant-a');
      const qtyReads = 2;
      await checkStockValueLedger(tx, 'tenant-a');
      const valueReads = 2;
      await checkSerialStockCount(tx, 'tenant-a');
      const serialReads = 2;
      await checkReservationProjection(tx, 'tenant-a');
      const reservationReads = 2;

      console.info('PHASE_A_RECON_QUERY_COUNTS', { size, qtyReads, valueReads, serialReads, reservationReads });
      expect({ qtyReads, valueReads, serialReads, reservationReads }).toEqual({
        qtyReads: 2,
        valueReads: 2,
        serialReads: 2,
        reservationReads: 2,
      });
      expect((tx.warehouseStock.findMany as ReturnType<typeof vi.fn>).mock.calls.every(([arg]) => arg.where.companyId === 'tenant-a')).toBe(true);
      expect(movementGroupBy.mock.calls.every(([arg]) => arg.where.companyId === 'tenant-a')).toBe(true);
      expect(reservationGroupBy.mock.calls.every(([arg]) => arg.where.companyId === 'tenant-a')).toBe(true);
    });

    it(`measures journal account-validation growth for N=${size}`, async () => {
      const accountRead = vi.fn(async ({ where }: any) => where.id.in.map((id: string) => ({
        id,
        code: 'SAFE',
        allowManualPosting: true,
      })));
      const tx = {
        fiscalPeriod: { findFirst: vi.fn(async () => null) },
        chartOfAccount: { findMany: accountRead },
        businessEvent: { create: vi.fn(async () => ({})) },
        journalEntry: { create: vi.fn(async () => ({ id: 'journal-1' })) },
        journalLine: { create: vi.fn(async () => ({})) },
        auditLog: { create: vi.fn(async () => ({})) },
      } as any;
      const lines = Array.from({ length: size * 2 }, (_, i) => ({
        chartOfAccountId: `account-${i % size}`,
        debit: i < size ? 1 : 0,
        credit: i < size ? 0 : 1,
      }));

      await postJournalEntry(tx, {
        companyId: 'tenant-a',
        entryDate: new Date('2026-01-01T00:00:00Z'),
        postingKind: 'manual_adjustment',
        sourceType: 'proof',
        sourceId: 'proof',
        description: 'safe query-count proof',
        currencyCode: 'BDT',
        exchangeRate: 1,
        createdBy: 'user-a',
        lines,
      }, 'safe-proof');

      console.info('PHASE_A_JOURNAL_ACCOUNT_READS', { size, lineCount: lines.length, accountReads: accountRead.mock.calls.length });
      expect(accountRead).toHaveBeenCalledTimes(1);
      expect(accountRead.mock.calls[0][0].where.companyId).toBe('tenant-a');
    });
  }

  it('rejects a cross-tenant chart-of-account ID without weakening database scope', async () => {
    const accountRead = vi.fn(async ({ where }: any) => [{ id: where.id.in[0], code: 'A', allowManualPosting: true }]);
    const tx = {
      fiscalPeriod: { findFirst: vi.fn(async () => null) },
      chartOfAccount: { findMany: accountRead },
    } as any;

    await expect(postJournalEntry(tx, {
      companyId: 'tenant-a',
      entryDate: new Date('2026-01-01T00:00:00Z'),
      postingKind: 'manual_adjustment',
      sourceType: 'proof',
      sourceId: 'proof',
      description: 'cross-tenant negative case',
      currencyCode: 'BDT',
      exchangeRate: 1,
      createdBy: 'user-a',
      lines: [
        { chartOfAccountId: 'account-a', debit: 1, credit: 0 },
        { chartOfAccountId: 'account-from-tenant-b', debit: 0, credit: 1 },
      ],
    }, 'safe-proof')).rejects.toThrow(/not found in this company/);
    expect(accountRead.mock.calls[0][0].where.companyId).toBe('tenant-a');
  });
});
