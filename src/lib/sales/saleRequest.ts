// The body of POST /api/v1/sales and POST /api/v1/sales/quote, and its mapping
// to PostSale's input. Shared so a quote is computed from exactly what posting
// would post.

import { z } from 'zod';
import type { PostSaleInput } from '@/domain/commands/m3/PostSale';
import type { PaymentArrangement } from '@/domain/receivables/schedule';

const SaleItemSchema = z.object({
  product_id: z.string().uuid(),
  qty: z.number().positive(),
  unit_price: z.number().min(0),
  discount_amount: z.number().min(0).optional(),
  serials: z.array(z.string()).optional(),
});

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const Money = z.string().regex(/^\d{1,15}(\.\d{1,2})?$/, 'An amount with at most two decimal places, as a string');

const PaymentSchema = z.object({
  payment_method: z.enum(['cash', 'card', 'cheque', 'bkash', 'nagad', 'rocket', 'bank_transfer', 'other']),
  amount: z.number().positive(),
  financial_account_id: z.string().uuid(),
  method_reference: z.string().max(120).optional(),
});

export const PostSaleSchema = z.object({
  branch_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  cashier_shift_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  currency_code: z.string().length(3).default('BDT'),
  exchange_rate: z.number().positive().default(1),
  sale_note: z.string().optional(),
  items: z.array(SaleItemSchema).min(1),
  // Empty for a sale entirely on credit; PostSale's credit checks decide
  // whether an unpaid remainder is allowed.
  payments: z.array(PaymentSchema).default([]),
  // When the unpaid part falls due (src/domain/receivables/schedule.ts).
  // Amounts are decimal strings, so they never pass through floating point;
  // 'equal' and a final 'rest' let the server do the arithmetic.
  payment_arrangement: z.discriminatedUnion('type', [
    z.object({ type: z.literal('due'), due_date: IsoDate }),
    z.object({ type: z.literal('installments'), installments: z.array(z.object({ due_date: IsoDate, amount: z.union([Money, z.literal('rest')]) })).min(1).max(60) }),
    z.object({ type: z.literal('equal'), count: z.number().int().min(1).max(60), first_due_date: IsoDate, interval_months: z.number().int().min(1).max(12).default(1) }),
  ]).optional(),
  reminder_phone: z.string().max(20).optional(),
  due_reminders_enabled: z.boolean().optional(),
});
export type PostSaleBody = z.infer<typeof PostSaleSchema>;

function arrangement(body: PostSaleBody): PaymentArrangement | undefined {
  const a = body.payment_arrangement;
  if (!a) return undefined;
  if (a.type === 'due') return { type: 'due', dueDate: a.due_date };
  if (a.type === 'equal') return { type: 'equal', count: a.count, firstDueDate: a.first_due_date, intervalMonths: a.interval_months };
  return { type: 'installments', installments: a.installments.map(i => ({ dueDate: i.due_date, amount: i.amount })) };
}

export function postSaleInput(body: PostSaleBody, auth: { companyId: string; userId: string }): PostSaleInput {
  return {
    companyId: auth.companyId,
    branchId: body.branch_id,
    warehouseId: body.warehouse_id,
    cashierId: auth.userId,
    cashierShiftId: body.cashier_shift_id,
    customerId: body.customer_id,
    currencyCode: body.currency_code,
    exchangeRate: body.exchange_rate,
    businessDate: new Date(),
    saleNote: body.sale_note,
    items: body.items.map(i => ({ productId: i.product_id, qty: i.qty, unitPrice: i.unit_price, discountAmount: i.discount_amount, serials: i.serials })),
    payments: body.payments.map(p => ({ paymentMethod: p.payment_method, amount: p.amount, financialAccountId: p.financial_account_id, methodReference: p.method_reference })),
    paymentArrangement: arrangement(body),
    reminderPhone: body.reminder_phone,
    dueRemindersEnabled: body.due_reminders_enabled,
  };
}
