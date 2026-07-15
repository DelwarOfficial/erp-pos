// GET /api/v1/journal-entries/{id} — single journal entry with lines
//
// Posted journal entries are IMMUTABLE (the production trigger
// `0002_prevent_posted_record_mutation.sql` blocks UPDATE/DELETE on posted
// rows). Reversal is the only sanctioned path and is exposed via a separate
// `/reverse` subroute (out of scope for this task). This route is read-only.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'journal.read');
    const { id } = await params;

    // findFirst (not findUnique) so the tenantClient extension can apply the
    // company_id filter as RLS-equivalent defence-in-depth.
    const entry = await db.journalEntry.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        lines: {
          orderBy: { lineNo: 'asc' },
          include: {
            chartOfAccount: {
              select: {
                id: true,
                code: true,
                name: true,
                accountClass: true,
                accountSubtype: true,
              },
            },
            branch: { select: { id: true, name: true, code: true } },
            financialAccount: { select: { id: true, name: true } },
            customer: { select: { id: true, name: true } },
            supplier: { select: { id: true, name: true } },
            product: { select: { id: true, name: true, code: true } },
          },
        },
        currency: { select: { code: true, name: true, symbol: true } },
        reversalOf: { select: { id: true, entryNo: true } },
        creator: { select: { id: true, name: true, email: true } },
        poster: { select: { id: true, name: true, email: true } },
      },
    });

    if (!entry) {
      throw new DomainError(
        'RESOURCE_NOT_FOUND',
        'Journal entry not found',
        { journal_entry_id: id },
        404,
      );
    }

    // Branch scope check — non-global users may only read entries whose lines
    // touch branches they are scoped to. Company-wide entries (no branch on
    // any line) are visible to any in-tenant user.
    if (!auth.isGlobal) {
      const lineBranchIds = entry.lines
        .map((l) => l.branchId)
        .filter((b): b is string => Boolean(b));
      if (lineBranchIds.length > 0) {
        const allowed = lineBranchIds.every((b) => auth.branchIds.includes(b));
        if (!allowed) {
          throw new DomainError(
            'FORBIDDEN_SCOPE',
            'Branch access denied for this journal entry',
            { branch_ids: lineBranchIds },
            403,
          );
        }
      }
    }

    // Compute totals from lines — Decimals must be stringified for the JSON
    // wire format. Journal entries are always balanced, but we expose both
    // the debit and credit totals so the client can render a footer.
    const totalDebit = entry.lines
      .reduce((sum, l) => sum + parseFloat(l.debitBase.toString()), 0)
      .toFixed(2);
    const totalCredit = entry.lines
      .reduce((sum, l) => sum + parseFloat(l.creditBase.toString()), 0)
      .toFixed(2);

    return NextResponse.json({
      id: entry.id,
      entry_no: entry.entryNo,
      event_id: entry.eventId,
      posting_kind: entry.postingKind,
      status: entry.status,
      entry_date: entry.entryDate,
      posting_date: entry.postingDate,
      description: entry.description,
      currency_code: entry.currencyCode,
      currency: entry.currency,
      exchange_rate: entry.exchangeRate.toString(),
      source_type: entry.sourceType,
      source_id: entry.sourceId,
      reversal_of: entry.reversalOf,
      created_by: entry.createdBy,
      creator: entry.creator,
      posted_by: entry.postedBy,
      poster: entry.poster,
      posted_at: entry.postedAt,
      created_at: entry.createdAt,
      total_debit: totalDebit,
      total_credit: totalCredit,
      line_count: entry.lines.length,
      lines: entry.lines.map((l) => ({
        id: l.id,
        line_no: l.lineNo,
        branch: l.branch,
        chart_of_account: l.chartOfAccount,
        financial_account: l.financialAccount,
        customer: l.customer,
        supplier: l.supplier,
        product: l.product,
        debit_base: l.debitBase.toString(),
        credit_base: l.creditBase.toString(),
        amount_currency: l.amountCurrency ? l.amountCurrency.toString() : null,
        currency_code: l.currencyCode,
        memo: l.memo,
      })),
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
