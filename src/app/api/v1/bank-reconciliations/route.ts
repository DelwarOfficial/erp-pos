// GET  /api/v1/bank-reconciliations — list reconciliations
// POST /api/v1/bank-reconciliations — create a new reconciliation (auto-imports system lines)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { createBankReconciliation, addStatementLinesBulk, StatementLineInput } from '@/domain/commands/m4/BankReconciliation';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const StatementLineSchema = z.object({
  transaction_date: z.string(),
  description: z.string().min(1).max(300),
  amount: z.number(),
  reference_no: z.string().max(120).optional(),
});

const CreateReconciliationSchema = z.object({
  financial_account_id: z.string().uuid(),
  statement_date: z.string(),
  statement_opening_balance: z.number(),
  statement_closing_balance: z.number(),
  system_opening_balance: z.number().optional(),
  import_since: z.string().optional(),
  statement_lines: z.array(StatementLineSchema).default([]),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'bank.reconciliation.view.company');

    const url = req.nextUrl;
    const status = url.searchParams.get('status') ?? undefined;
    const financialAccountId = url.searchParams.get('financial_account_id') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.status = status;
    if (financialAccountId) where.financialAccountId = financialAccountId;

    const items = await db.bankReconciliation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        financialAccount: { select: { id: true, name: true, accountType: true } },
      },
    });

    return NextResponse.json({
      items: items.map(r => ({
        id: r.id,
        financial_account: r.financialAccount,
        statement_date: r.statementDate,
        statement_opening_balance: r.statementOpeningBalance.toString(),
        statement_closing_balance: r.statementClosingBalance.toString(),
        system_opening_balance: r.systemOpeningBalance.toString(),
        system_closing_balance: r.systemClosingBalance.toString(),
        status: r.status,
        matched_transactions: r.matchedTransactions,
        unmatched_system: r.unmatchedSystem,
        unmatched_statement: r.unmatchedStatement,
        variance: r.variance.toString(),
        reconciled_by: r.reconciledBy,
        reconciled_at: r.reconciledAt,
        created_at: r.createdAt,
      })),
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'bank.reconciliation.manage.company');

    const idempotencyKey = requireIdempotencyKey(req);
    const body = CreateReconciliationSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/bank-reconciliations', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'bank_reconciliation.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const r = await createBankReconciliation(tx, {
              companyId: auth.companyId,
              financialAccountId: body.financial_account_id,
              statementDate: new Date(body.statement_date),
              statementOpeningBalance: body.statement_opening_balance,
              statementClosingBalance: body.statement_closing_balance,
              systemOpeningBalance: body.system_opening_balance,
              importSince: body.import_since ? new Date(body.import_since) : undefined,
              createdBy: auth.userId!,
            }, correlationId);

            // Bulk-add any supplied statement lines
            let statementLinesAdded = 0;
            if (body.statement_lines.length > 0) {
              const lines: StatementLineInput[] = body.statement_lines.map(l => ({
                transactionDate: new Date(l.transaction_date),
                description: l.description,
                amount: l.amount,
                referenceNo: l.reference_no,
              }));
              const bulk = await addStatementLinesBulk(tx, {
                reconciliationId: r.reconciliationId,
                companyId: auth.companyId,
                lines,
                userId: auth.userId!,
              }, correlationId);
              statementLinesAdded = bulk.added;
            }

            return {
              status: 201,
              body: {
                id: r.reconciliationId,
                status: r.status,
                system_lines_imported: r.systemLinesImported,
                statement_lines_added: statementLinesAdded,
                system_closing_balance: r.systemClosingBalance,
                variance: r.variance,
              },
              resourceType: 'bank_reconciliation',
              resourceId: r.reconciliationId,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid reconciliation payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
