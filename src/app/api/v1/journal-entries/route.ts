// GET  /api/v1/journal-entries  — list journal entries
// POST /api/v1/journal-entries  — post a manual journal entry

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const JournalLineSchema = z.object({
  chart_of_account_id: z.string().uuid(),
  branch_id: z.string().uuid().optional(),
  financial_account_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  supplier_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  debit: z.number().min(0),
  credit: z.number().min(0),
  memo: z.string().max(255).optional(),
});

const PostJournalSchema = z.object({
  entry_date: z.string().datetime(),
  description: z.string().min(1).max(255),
  currency_code: z.string().length(3).default('BDT'),
  exchange_rate: z.number().positive().default(1),
  lines: z.array(JournalLineSchema).min(2),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'journal.post');
  await requirePermission(auth, 'journal.read');
    const url = req.nextUrl;
    const status = url.searchParams.get('status') ?? undefined;
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.status = status;
    if (from || to) {
      where.entryDate = {};
      if (from) (where.entryDate as Record<string, unknown>).gte = new Date(from);
      if (to) (where.entryDate as Record<string, unknown>).lte = new Date(to);
    }

    const entries = await db.journalEntry.findMany({
      where, take: limit, orderBy: { entryDate: 'desc' },
      select: {
        id: true,
        entryNo: true,
        status: true,
        entryDate: true,
        postingDate: true,
        description: true,
        currencyCode: true,
        sourceType: true,
        sourceId: true,
        reversalOfEntryId: true,
        createdBy: true,
        lines: {
          // Cap lines per entry to keep payload bounded on large journals.
          take: 200,
          include: {
            chartOfAccount: { select: { id: true, code: true, name: true, accountClass: true } },
            branch: { select: { id: true, name: true, code: true } },
          },
        },
        creator: { select: { id: true, name: true } },
        _count: { select: { lines: true } },
      },
    });

    return NextResponse.json({
      items: entries.map(e => ({
        id: e.id, entry_no: e.entryNo, status: e.status,
        entry_date: e.entryDate, posting_date: e.postingDate,
        description: e.description, currency_code: e.currencyCode,
        source_type: e.sourceType, source_id: e.sourceId,
        reversal_of_entry_id: e.reversalOfEntryId,
        line_count: e._count.lines,
        creator: e.creator,
        total_debit: e.lines.reduce((s, l) => s + parseFloat(l.debitBase.toString()), 0).toFixed(2),
        total_credit: e.lines.reduce((s, l) => s + parseFloat(l.creditBase.toString()), 0).toFixed(2),
        lines: e.lines.map(l => ({
          line_no: l.lineNo,
          account: l.chartOfAccount,
          branch: l.branch,
          debit: l.debitBase.toString(),
          credit: l.creditBase.toString(),
          memo: l.memo,
        })),
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    const body = PostJournalSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/journal-entries', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'journal_entry.post', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const result = await postJournalEntry(tx, {
              companyId: auth.companyId,
              entryDate: new Date(body.entry_date),
              postingKind: 'manual_adjustment',
              sourceType: 'manual',
              sourceId: 'manual',
              description: body.description,
              currencyCode: body.currency_code,
              exchangeRate: body.exchange_rate,
              createdBy: auth.userId,
              lines: body.lines.map(l => ({
                chartOfAccountId: l.chart_of_account_id,
                branchId: l.branch_id,
                financialAccountId: l.financial_account_id,
                customerId: l.customer_id,
                supplierId: l.supplier_id,
                productId: l.product_id,
                debit: l.debit,
                credit: l.credit,
                memo: l.memo,
              })),
            }, correlationId);
            return { status: 201, body: result, resourceType: 'journal_entry', resourceId: result.journalEntryId };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid journal payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
