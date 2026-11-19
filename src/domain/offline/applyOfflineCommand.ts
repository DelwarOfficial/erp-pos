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
import { OFFLINE_CLOCK_SKEW_MS, OFFLINE_MAX_AGE_MS } from '@/lib/offline/syncLimits';

/** 'applied' performed the business effect; 'stored' recorded it only. */
export type OfflineCommandOutcome =
  | { status: 'applied'; resourceType: string; resourceId: string }
  | { status: 'stored'; reason: string };

const CashSalePayload = z.object({
  branch_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  cashier_shift_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  // The cashier signed in on the till when the sale was taken. Accepted only
  // when that same person sends it (see cash_sale below), so it is never
  // trusted on its own.
  cashier_id: z.string().uuid().optional(),
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
  // Offline sales are cash only and paid in full: card, wallet, gift card and
  // points need the server at the moment of sale, and nothing may be left
  // owing (postSale refuses an unpaid balance without a payment arrangement).
  payments: z.array(z.object({
    payment_method: z.literal('cash'),
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
    /** A manager posting a sale whose cashier can no longer sign in (route checks approval.resolve). */
    adoptReason?: string;
  },
  correlationId: string,
): Promise<OfflineCommandOutcome> {
  switch (params.commandType) {
    case 'cash_sale': {
      const payload = parse(CashSalePayload, params.payload, 'cash_sale');
      // The capture time comes from the till, so it is bounded: not ahead of
      // the server (5 minutes for clock drift) and not older than a till can
      // plausibly hold sales. Otherwise a sale could be dated into any open period.
      const capturedAt = new Date(payload.business_date).getTime();
      if (capturedAt > Date.now() + OFFLINE_CLOCK_SKEW_MS || capturedAt < Date.now() - OFFLINE_MAX_AGE_MS) {
        throw new DomainError('VALIDATION_FAILED',
          `An offline sale must be dated within the last ${OFFLINE_MAX_AGE_MS / 86_400_000} days and not in the future`,
          { business_date: payload.business_date }, 400);
      }
      // Who took the sale. Only the cashier who took it may send it; nobody
      // else's sign-in is credited with it. A manager may post it instead only
      // when that cashier can no longer sign in, and the audit log keeps both.
      let adopted: { originalCashierId: string | null; originalCashierName: string | null } | null = null;
      if (payload.cashier_id !== params.userId) {
        if (!params.adoptReason) {
          if (!payload.cashier_id) throw new DomainError('OFFLINE_CASHIER_UNKNOWN', 'This offline sale does not say which cashier took it. A manager must post it from the till.', {}, 409);
          throw new DomainError('OFFLINE_CASHIER_MISMATCH', 'Another cashier took this offline sale. They must sign in on this till to send it.', { cashier_id: payload.cashier_id }, 409);
        }
        const original = payload.cashier_id
          ? await tx.user.findFirst({ where: { id: payload.cashier_id, companyId: params.companyId }, select: { id: true, name: true, isActive: true, deletedAt: true } })
          : null;
        if (original && original.isActive && !original.deletedAt) {
          throw new DomainError('OFFLINE_CASHIER_MISMATCH', `${original.name} can still sign in. Ask them to sign in on this till and send it.`, { cashier_id: original.id }, 409);
        }
        adopted = { originalCashierId: original?.id ?? payload.cashier_id ?? null, originalCashierName: original?.name ?? null };
      }
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
      if (adopted) {
        await tx.auditLog.create({ data: { companyId: params.companyId, userId: params.userId, correlationId, action: 'offline.sale_posted_by_manager',
          entityType: 'sale', entityId: sale.saleId, afterValue: JSON.stringify({ original_cashier_id: adopted.originalCashierId,
            original_cashier_name: adopted.originalCashierName, posted_by: params.userId, reason: params.adoptReason }) } });
      }
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
        // Offline closes carry no approval: a large variance waits for a manager online.
        closerCanApprove: false,
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
