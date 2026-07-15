// GET  /api/v1/expenses/{id}  — single expense with items, category, branch
// PUT  /api/v1/expenses/{id}  — update a DRAFT / pending_approval expense
//
// Posted expenses are IMMUTABLE (production trigger
// `0002_prevent_posted_record_mutation.sql` blocks UPDATE/DELETE on rows
// with status='posted'/'approved'/'voided'). Mutations are only permitted
// while the document is still in a draft state. Once posted, the only
// sanctioned mutation is a reversal — exposed via a sibling subroute.
// DELETE is intentionally NOT implemented: financial documents must remain
// auditable forever (§5.15 statutory retention).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import {
  withIdempotency,
  computeRequestHash,
  requireIdempotencyKey,
} from '@/lib/idempotency';
import { audit } from '@/lib/audit';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

// Statuses that may still be edited via PUT. Once an expense reaches
// 'approved' / 'posted' / 'rejected' / 'voided' it is immutable.
const EDITABLE_STATUSES = new Set(['draft', 'pending_approval']);

// Partial-update schema — every field is optional. The body is validated
// against the same rules used by the POST /expenses endpoint so PUT and
// POST accept identical field shapes. Items cannot be edited here — they
// have their own subresource (an expense with wrong items should be voided
// and re-created rather than retroactively edited).
const ExpenseUpdateSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  supplier_id: z.string().uuid().nullable().optional(),
  payee_name: z.string().max(200).nullable().optional(),
  expense_date: z.string().optional(),
  currency_code: z.string().length(3).optional(),
  exchange_rate: z.number().positive().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'expense.read');
    const { id } = await params;

    const expense = await db.expense.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, name: true, phone: true } },
        currency: { select: { code: true, name: true, decimalPlaces: true } },
        requester: { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true, email: true } },
        journalEntry: { select: { id: true, entryNo: true } },
        items: {
          orderBy: { lineNo: 'asc' },
          include: {
            expenseCategory: {
              select: { id: true, name: true, isActive: true },
            },
          },
        },
        attachments: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            sha256: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!expense) {
      throw new DomainError(
        'RESOURCE_NOT_FOUND',
        'Expense not found',
        { expense_id: id },
        404,
      );
    }

    // Branch scope check
    if (!auth.isGlobal && !auth.branchIds.includes(expense.branchId)) {
      throw new DomainError(
        'FORBIDDEN_SCOPE',
        'Branch access denied for this expense',
        { branch_id: expense.branchId },
        403,
      );
    }

    return NextResponse.json({
      id: expense.id,
      reference_no: expense.referenceNo,
      client_txn_id: expense.clientTxnId,
      status: expense.status,
      expense_date: expense.expenseDate,
      currency_code: expense.currencyCode,
      currency: expense.currency,
      exchange_rate: expense.exchangeRate.toString(),
      subtotal: expense.subtotal.toString(),
      tax_total: expense.taxTotal.toString(),
      grand_total: expense.grandTotal.toString(),
      base_grand_total: expense.baseGrandTotal.toString(),
      description: expense.description,
      payee_name: expense.payeeName,
      branch: expense.branch,
      supplier: expense.supplier,
      requested_by: expense.requestedBy,
      requester: expense.requester,
      approved_by: expense.approvedBy,
      approver: expense.approver,
      approval_request_id: expense.approvalRequestId,
      journal_entry: expense.journalEntry,
      posted_at: expense.postedAt,
      created_at: expense.createdAt,
      items: expense.items.map((i) => ({
        id: i.id,
        line_no: i.lineNo,
        expense_category_id: i.expenseCategoryId,
        expense_category: i.expenseCategory,
        description: i.description,
        amount: i.amount.toString(),
        tax_amount: i.taxAmount.toString(),
        base_amount: i.baseAmount.toString(),
      })),
      attachments: expense.attachments,
      item_count: expense.items.length,
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    // Either the original poster (expense.post) or an approver
    // (expense.approve) may edit a draft expense. Both permissions gate
    // mutation of unposted expenses.
    await requirePermission(auth, 'expense.post');
    const { id } = await params;

    const idempotencyKey = requireIdempotencyKey(req);
    const body = ExpenseUpdateSchema.parse(await req.json());
    const requestHash = computeRequestHash({
      method: 'PUT',
      path: `/api/v1/expenses/${id}`,
      body,
    });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        {
          idempotencyKey,
          operation: 'expense.update',
          requestHash,
          companyId: auth.companyId,
          userId: auth.userId,
        },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // 1. Fetch the existing expense, RLS-scoped to the caller's company.
            const existing = await tx.expense.findFirst({
              where: { id, companyId: auth.companyId },
            });
            if (!existing) {
              throw new DomainError(
                'RESOURCE_NOT_FOUND',
                'Expense not found',
                { expense_id: id },
                404,
              );
            }

            // 2. Branch access control.
            if (
              !auth.isGlobal &&
              !auth.branchIds.includes(existing.branchId)
            ) {
              throw new DomainError(
                'FORBIDDEN_SCOPE',
                'Branch access denied for this expense',
                { branch_id: existing.branchId },
                403,
              );
            }

            // 3. State guard — only draft / pending_approval may be edited.
            if (!EDITABLE_STATUSES.has(existing.status)) {
              throw new DomainError(
                'VALIDATION_FAILED',
                `Expense cannot be edited from status '${existing.status}'`,
                { expense_id: id, current_status: existing.status },
                409,
              );
            }

            // 4. If supplier_id is being changed, validate it belongs to this
            //    tenant and isn't soft-deleted.
            if (body.supplier_id !== undefined && body.supplier_id !== null) {
              const supplier = await tx.supplier.findFirst({
                where: {
                  id: body.supplier_id,
                  companyId: auth.companyId,
                  deletedAt: null,
                },
              });
              if (!supplier) {
                throw new DomainError(
                  'VALIDATION_FAILED',
                  'Supplier not found',
                  { supplier_id: body.supplier_id },
                  400,
                );
              }
            }

            // 5. Build the update payload — only fields that were actually
            //    supplied. `undefined` would be ignored by Prisma anyway,
            //    but explicit handling avoids accidental nulls.
            const updateData: Record<string, unknown> = {};
            if (body.description !== undefined)
              updateData.description = body.description;
            if (body.supplier_id !== undefined)
              updateData.supplierId = body.supplier_id;
            if (body.payee_name !== undefined)
              updateData.payeeName = body.payee_name;
            if (body.expense_date !== undefined)
              updateData.expenseDate = new Date(body.expense_date);
            if (body.currency_code !== undefined)
              updateData.currencyCode = body.currency_code;
            if (body.exchange_rate !== undefined)
              updateData.exchangeRate = body.exchange_rate;

            // 6. Apply the update.
            const updated = await tx.expense.update({
              where: { id: existing.id },
              data: updateData,
            });

            // 7. Append-only audit log.
            await audit({
              action: 'expense.update',
              entityType: 'expense',
              entityId: updated.id,
              beforeValue: {
                description: existing.description,
                supplier_id: existing.supplierId,
                payee_name: existing.payeeName,
                expense_date: existing.expenseDate,
                currency_code: existing.currencyCode,
                exchange_rate: existing.exchangeRate.toString(),
                status: existing.status,
              },
              afterValue: {
                description: updated.description,
                supplier_id: updated.supplierId,
                payee_name: updated.payeeName,
                expense_date: updated.expenseDate,
                currency_code: updated.currencyCode,
                exchange_rate: updated.exchangeRate.toString(),
                status: updated.status,
              },
            });

            return {
              status: 200,
              body: {
                id: updated.id,
                reference_no: updated.referenceNo,
                status: updated.status,
                description: updated.description,
                supplier_id: updated.supplierId,
                payee_name: updated.payeeName,
                expense_date: updated.expenseDate,
                currency_code: updated.currencyCode,
                exchange_rate: updated.exchangeRate.toString(),
                grand_total: updated.grandTotal.toString(),
                updated_at: updated.createdAt,
              },
              resourceType: 'expense',
              resourceId: updated.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(
        new DomainError(
          'VALIDATION_FAILED',
          'Invalid expense update payload',
          { issues: e.issues },
          400,
        ),
        correlationId,
      );
    }
    return errorResponse(e, correlationId);
  }
}
