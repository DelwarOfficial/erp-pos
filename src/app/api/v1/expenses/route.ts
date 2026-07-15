// GET  /api/v1/expenses  — list expenses
// POST /api/v1/expenses  — create + post an expense

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postExpense } from '@/domain/commands/m4/PostExpense';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const PostExpenseSchema = z.object({
  branch_id: z.string().uuid(),
  expense_date: z.string(),
  currency_code: z.string().default('BDT'),
  exchange_rate: z.number().positive().default(1.0),
  description: z.string().min(1).max(500),
  supplier_id: z.string().uuid().optional(),
  payee_name: z.string().max(200).optional(),
  financial_account_id: z.string().uuid(),
  items: z.array(z.object({
    expense_category_id: z.string().uuid(),
    description: z.string().optional(),
    amount: z.number().positive(),
    tax_amount: z.number().min(0).default(0),
  })).min(1),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    
    await requirePermission(auth, 'expense.read');

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const [items, total] = await Promise.all([
      db.expense.findMany({
        where: { companyId: auth.companyId },
        orderBy: { createdAt: 'desc' },
        take: limit, skip: offset,
        select: { id: true, referenceNo: true, status: true, expenseDate: true, grandTotal: true, description: true, createdAt: true },
      }),
      db.expense.count({ where: { companyId: auth.companyId } }),
    ]);
    return NextResponse.json({ items, total, limit, offset });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    
    await requirePermission(auth, 'expense.post');

    const idempotencyKey = requireIdempotencyKey(req);
    const body = PostExpenseSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/expenses', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'expense.post', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // Call the domain command — controller calls ONE command per §7 rule 2
            const expense = await postExpense(tx, {
              companyId: auth.companyId,
              branchId: body.branch_id,
              expenseDate: new Date(body.expense_date),
              currencyCode: body.currency_code,
              exchangeRate: body.exchange_rate,
              description: body.description,
              supplierId: body.supplier_id,
              payeeName: body.payee_name,
              financialAccountId: body.financial_account_id,
              items: body.items.map(i => ({
                expenseCategoryId: i.expense_category_id,
                description: i.description,
                amount: i.amount,
                taxAmount: i.tax_amount,
              })),
              createdBy: auth.userId!,
            }, correlationId);

            return {
              status: 201,
              body: {
                id: expense.expenseId,
                reference_no: expense.referenceNo,
                status: expense.status,
                grand_total: expense.grandTotal.toString(),
                journal_entry_no: expense.journalEntryNo,
              },
              resourceType: 'expense',
              resourceId: expense.expenseId,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid expense payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
