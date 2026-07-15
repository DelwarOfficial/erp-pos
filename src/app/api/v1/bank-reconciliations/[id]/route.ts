// GET /api/v1/bank-reconciliations/{id} — single reconciliation with all lines

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { DomainError } from '@/lib/errors/codes';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'bank.reconciliation.view.company');
    const { id } = await params;

    const rec = await db.bankReconciliation.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        financialAccount: { select: { id: true, name: true, accountType: true, currencyCode: true } },
        lines: { orderBy: [{ lineType: 'asc' }, { transactionDate: 'asc' }] },
      },
    });
    if (!rec) throw new DomainError('RESOURCE_NOT_FOUND', 'Reconciliation not found', {}, 404);

    return NextResponse.json({
      id: rec.id,
      financial_account: rec.financialAccount,
      statement_date: rec.statementDate,
      statement_opening_balance: rec.statementOpeningBalance.toString(),
      statement_closing_balance: rec.statementClosingBalance.toString(),
      system_opening_balance: rec.systemOpeningBalance.toString(),
      system_closing_balance: rec.systemClosingBalance.toString(),
      status: rec.status,
      matched_transactions: rec.matchedTransactions,
      unmatched_system: rec.unmatchedSystem,
      unmatched_statement: rec.unmatchedStatement,
      variance: rec.variance.toString(),
      journal_entry_id: rec.journalEntryId,
      reconciled_by: rec.reconciledBy,
      reconciled_at: rec.reconciledAt,
      created_at: rec.createdAt,
      lines: rec.lines.map(l => ({
        id: l.id,
        line_type: l.lineType,
        transaction_date: l.transactionDate,
        description: l.description,
        amount: l.amount.toString(),
        reference_no: l.referenceNo,
        payment_id: l.paymentId,
        matched_line_id: l.matchedLineId,
        match_status: l.matchStatus,
        match_method: l.matchMethod,
        matched_by: l.matchedBy,
        matched_at: l.matchedAt,
      })),
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
