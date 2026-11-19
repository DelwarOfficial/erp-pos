// POST /api/v1/journal-entries/{id}/reverse  { reason }
// Reverses a posted manual journal entry with an equal and opposite entry
// (journal.reverse, fresh MFA). The original stays in the ledger, marked
// reversed. Entries made by other documents (sales, purchases, payments...)
// are reversed through those documents -- a void or return -- so their stock,
// payments and status stay consistent; this route refuses them.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { requireMfaForAction } from '@/lib/auth/requireMfa';
import { reverseJournalEntry } from '@/domain/commands/m4/PostJournalEntry';

const ReverseSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'journal.reverse');
    await requireMfaForAction(req, 'journal_adjustment_approval');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = ReverseSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/journal-entries/${id}/reverse`, body });
    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async tx =>
        withIdempotency(
          { idempotencyKey, operation: 'journal.reverse', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const entry = await tx.journalEntry.findFirst({ where: { id, companyId: auth.companyId }, select: { postingKind: true, sourceType: true } });
            if (!entry) throw new DomainError('RESOURCE_NOT_FOUND', 'Journal entry not found', {}, 404);
            if (entry.postingKind !== 'manual_adjustment') {
              throw new DomainError('VALIDATION_FAILED', `This entry belongs to a ${entry.sourceType.replaceAll('_', ' ')}; reverse it from that document (void or return) instead`, {}, 409);
            }
            const reversal = await reverseJournalEntry(tx, { journalEntryId: id, companyId: auth.companyId, reversedBy: auth.userId, reason: body.reason }, correlationId);
            await tx.auditLog.create({ data: { companyId: auth.companyId, userId: auth.userId, correlationId,
              action: 'journal.reverse', entityType: 'journal_entry', entityId: id,
              afterValue: JSON.stringify({ reversal_entry_no: reversal.entryNo, reason: body.reason }) } });
            return { status: 201, body: { reversed_entry_id: id, reversal_entry_id: reversal.journalEntryId, reversal_entry_no: reversal.entryNo }, resourceType: 'journal_entry', resourceId: id };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Give a reason for the reversal', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
