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
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { assertBranchAccess } from '@/lib/db/branchScope';
import { getApprovalThresholds } from '@/lib/approval/thresholds';
import { checkCumulativeThreshold, cumulativeAuditData } from '@/lib/approval/cumulative';
import { requireMfaForAction } from '@/lib/auth/requireMfa';
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

    const entries = await runInTenantContext(auth.ctx, async () => {
      return db.journalEntry.findMany({
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
          orderBy: { lineNo: 'asc' },
          include: {
            chartOfAccount: { select: { id: true, code: true, name: true, accountClass: true } },
            branch: { select: { id: true, name: true, code: true } },
          },
        },
        creator: { select: { id: true, name: true } },
        _count: { select: { lines: true } },
        },
      });
    });

    // Totals must cover the complete immutable journal, not the 200-line preview.
    // IDs are bounded by the header page size and remain tenant/branch scoped.
    const totals = entries.length ? await runInTenantContext(auth.ctx, async () => {
      return db.journalLine.groupBy({
        by: ['journalEntryId'],
        where: { companyId: auth.companyId, journalEntryId: { in: entries.map(entry => entry.id) } },
        _sum: { debitBase: true, creditBase: true },
      });
    }) : [];
    const totalsByEntry = new Map(totals.map(total => [total.journalEntryId, total._sum]));

    return NextResponse.json({
      items: entries.map(e => ({
        id: e.id, entry_no: e.entryNo, status: e.status,
        entry_date: e.entryDate, posting_date: e.postingDate,
        description: e.description, currency_code: e.currencyCode,
        source_type: e.sourceType, source_id: e.sourceId,
        reversal_of_entry_id: e.reversalOfEntryId,
        line_count: e._count.lines,
        creator: e.creator,
        total_debit: totalsByEntry.get(e.id)?.debitBase?.toString() ?? '0',
        total_credit: totalsByEntry.get(e.id)?.creditBase?.toString() ?? '0',
        lines_truncated: e._count.lines > e.lines.length,
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
    await requirePermission(auth, 'journal.post');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = PostJournalSchema.parse(await req.json());
    // Lines may only name branches the poster can act in.
    for (const line of body.lines) if (line.branch_id) assertBranchAccess(line.branch_id, auth.ctx);
    // A large manual adjustment needs someone who can approve it, with a fresh
    // MFA check. Any amount used to post on journal.post alone.
    const total = body.lines.reduce((sum, l) => sum.plus(l.debit ?? 0), new Prisma.Decimal(0)).mul(body.exchange_rate ?? 1);
    const { journal_adjustment_threshold: threshold } = await runInTenantContext(auth.ctx, async () => getApprovalThresholds(auth.companyId));
    // The poster's own manual journals of the last 24 hours count too, so a
    // large adjustment split into sub-threshold pieces still needs approval
    // once the running total crosses the threshold (workstream 7).
    const cumulative = await runInTenantContext(auth.ctx, async () =>
      checkCumulativeThreshold(db, 'journal', { companyId: auth.companyId, userId: auth.userId, amountBase: total, threshold }));
    if (cumulative.required) {
      try {
        await requirePermission(auth, 'approval.resolve');
      } catch (e) {
        // One journal over the threshold is refused as before.
        if (cumulative.single) throw e;
        throw new DomainError('APPROVAL_REQUIRED',
          `Your journals in the last 24 hours would total ${cumulative.cumulative}, above ${threshold}. Ask someone who can approve to post this one.`,
          { threshold, amount_base: total.toFixed(2), cumulative_base: cumulative.cumulative }, 403);
      }
      await requireMfaForAction(req, 'journal_adjustment_approval');
    }
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/journal-entries', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async (tx) =>
        withIdempotency(
          { idempotencyKey, operation: 'journal_entry.post', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const result = await postJournalEntry(tx, {
              companyId: auth.companyId,
              entryDate: new Date(body.entry_date),
              postingKind: 'manual_adjustment',
              sourceType: 'manual',
              // Each manual entry is its own source. The fixed 'manual' id gave
              // every manual entry the same event key, so a company could post
              // only one manual journal ever.
              sourceId: randomUUID(),
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
            if (cumulative.required && !cumulative.single) {
              await tx.auditLog.create({ data: cumulativeAuditData({ companyId: auth.companyId, userId: auth.userId, correlationId, kind: 'journal',
                entityType: 'journal_entry', entityId: result.journalEntryId, check: cumulative, amountBase: total }) });
            }
            return { status: 201, body: result, resourceType: 'journal_entry', resourceId: result.journalEntryId };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid journal payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
