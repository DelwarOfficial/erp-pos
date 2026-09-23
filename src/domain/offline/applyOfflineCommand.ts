// Applies a command captured by a POS terminal while it was offline.
//
// Commands used to be stored with status 'synced' and never executed: there was
// no reader of offline_commands anywhere, and no worker registered for the
// offline-sync queue. A terminal could take a day of cash sales, reconnect,
// receive `synced_count: 200`, and have produced no sale, no payment, no stock
// movement and no journal.
//
// Each command is now dispatched to the same domain command the online path
// uses, inside the caller's transaction, so an offline sale posts exactly what
// an online sale posts. Commands with no financial effect are recorded rather
// than executed, and say so.

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { postSale } from '@/domain/commands/m3/PostSale';
import { openCashierShift, closeCashierShift } from '@/domain/commands/m3/CashierShift';
import { DomainError } from '@/lib/errors/codes';

/** 'applied' performed the business effect; 'stored' recorded it only. */
export type OfflineCommandOutcome =
  | { status: 'applied'; resourceType: string; resourceId: string }
  | { status: 'stored'; reason: string };

const CashSalePayload = z.object({
  branch_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  cashier_shift_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  currency_code: z.string().min(3).max(3),
  exchange_rate: z.number().positive(),
  business_date: z.string().datetime(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    qty: z.number().positive(),
    unit_price: z.number().nonnegative(),
    discount_amount: z.number().nonnegative().optional(),
    serials: z.array(z.string()).optional(),
  })).min(1),
  payments: z.array(z.object({
    payment_method: z.string().min(1),
    amount: z.number().positive(),
    financial_account_id: z.string().uuid(),
    method_reference: z.string().optional(),
  })).min(1),
}).strict();

const ShiftOpenPayload = z.object({
  branch_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  cash_account_id: z.string().uuid(),
  opening_float: z.number().nonnegative(),
}).strict();

const ShiftClosePayload = z.object({
  shift_id: z.string().uuid(),
  counted_closing_cash: z.number().nonnegative(),
  variance_reason: z.string().max(500).optional(),
  approved_by: z.string().uuid().optional(),
}).strict();

export async function applyOfflineCommand(
  tx: Prisma.TransactionClient,
  params: {
    companyId: string;
    userId: string;
    commandType: string;
    payload: unknown;
  },
  correlationId: string,
): Promise<OfflineCommandOutcome> {
  switch (params.commandType) {
    case 'cash_sale': {
      const payload = parse(CashSalePayload, params.payload, 'cash_sale');
      const sale = await postSale(tx, {
        companyId: params.companyId,
        branchId: payload.branch_id,
        warehouseId: payload.warehouse_id,
        cashierId: params.userId,
        cashierShiftId: payload.cashier_shift_id,
        customerId: payload.customer_id,
        currencyCode: payload.currency_code,
        exchangeRate: payload.exchange_rate,
        // The terminal's own capture time, so the sale lands in the fiscal
        // period it happened in rather than the period it was uploaded in.
        businessDate: new Date(payload.business_date),
        items: payload.items.map(item => ({
          productId: item.product_id,
          qty: item.qty,
          unitPrice: item.unit_price,
          discountAmount: item.discount_amount,
          serials: item.serials,
        })),
        payments: payload.payments.map(payment => ({
          paymentMethod: payment.payment_method,
          amount: payment.amount,
          financialAccountId: payment.financial_account_id,
          methodReference: payment.method_reference,
        })),
      }, correlationId);
      return { status: 'applied', resourceType: 'sale', resourceId: sale.saleId };
    }

    case 'shift_open': {
      const payload = parse(ShiftOpenPayload, params.payload, 'shift_open');
      const shift = await openCashierShift(tx, {
        companyId: params.companyId,
        branchId: payload.branch_id,
        warehouseId: payload.warehouse_id,
        cashierId: params.userId,
        cashAccountId: payload.cash_account_id,
        openingFloat: payload.opening_float,
      }, correlationId);
      return { status: 'applied', resourceType: 'cashier_shift', resourceId: shift.shiftId };
    }

    case 'shift_close': {
      const payload = parse(ShiftClosePayload, params.payload, 'shift_close');
      const shift = await closeCashierShift(tx, {
        shiftId: payload.shift_id,
        companyId: params.companyId,
        closedBy: params.userId,
        countedClosingCash: payload.counted_closing_cash,
        varianceReason: payload.variance_reason,
        approvedBy: payload.approved_by,
      }, correlationId);
      return { status: 'applied', resourceType: 'cashier_shift', resourceId: shift.shiftId };
    }

    // No financial effect: a held draft is a terminal-local parking slot, a
    // reprint is an audit trail entry. Recording them is the whole job.
    case 'held_sale_draft':
    case 'receipt_reprint':
    case 'customer_create':
      return { status: 'stored', reason: `${params.commandType} is recorded for audit and has no posting effect` };

    default:
      throw new DomainError('VALIDATION_FAILED', `Unsupported offline command type: ${params.commandType}`, { command_type: params.commandType }, 400);
  }
}

function parse<T extends z.ZodTypeAny>(schema: T, payload: unknown, commandType: string): z.infer<T> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new DomainError('VALIDATION_FAILED',
      `Invalid ${commandType} payload`,
      { command_type: commandType, issues: result.error.issues }, 400);
  }
  return result.data;
}
