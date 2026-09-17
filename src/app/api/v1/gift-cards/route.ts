// GET  /api/v1/gift-cards  — list gift cards
// POST /api/v1/gift-cards  — issue a gift card

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { issueGiftCard } from '@/domain/commands/m6/Loyalty';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { requireFeatureFlag } from '@/lib/featureFlags';
import { Prisma } from '@prisma/client';

const common = {
  face_value: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
  branch_id: z.string().uuid(),
  expires_at: z.string().datetime().optional(),
};
const GiftCardSchema = z.discriminatedUnion('mode', [
  z.object({ ...common, mode: z.literal('sold'), financial_account_id: z.string().uuid(), cash_received: z.literal(true) }).strict(),
  z.object({ ...common, mode: z.literal('promotional'), expense_account_id: z.string().uuid() }).strict(),
]);

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, "gift_card.read");
    const cards = await runInTenantContext(auth.ctx, async () => {
      return db.giftCard.findMany({
        where: { companyId: auth.companyId },
        take: 50, orderBy: { issuedAt: 'desc' },
      });
    });
    return NextResponse.json({
      items: cards.map(c => ({
        id: c.id, code: c.code, status: c.status,
        face_value: c.faceValue.toString(),
        issued_at: c.issuedAt, expires_at: c.expiresAt,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, "gift_card.issue");
    const idempotencyKey = requireIdempotencyKey(req);
    const body = GiftCardSchema.parse(await req.json());
    await requirePermission(auth, 'gift_card.issue', body.branch_id);
    if (body.mode === 'sold') await requirePermission(auth, 'payment.pay.branch', body.branch_id);
    else await requirePermission(auth, 'journal.post', body.branch_id);
    await runInTenantContext(auth.ctx, async () => {
      await requireFeatureFlag('loyalty_enabled');
    });
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/gift-cards', body });

    const result = await withTenant(auth.ctx, async (tx) =>
      withIdempotency(
        { idempotencyKey, operation: 'gift_card.issue', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          const card = await issueGiftCard(tx, {
            companyId: auth.companyId, branchId: body.branch_id, issuedBy: auth.userId,
            faceValue: body.face_value, expiresAt: body.expires_at ? new Date(body.expires_at) : undefined,
            ...(body.mode === 'sold'
              ? { mode: 'sold' as const, financialAccountId: body.financial_account_id, cashReceived: body.cash_received }
              : { mode: 'promotional' as const, expenseAccountId: body.expense_account_id }),
          }, correlationId);
          return { status: 201, body: { id: card.giftCardId, code: card.code, face_value: card.faceValue,
            journal_entry_id: card.journalEntryId, payment_id: card.paymentId },
            resourceType: 'gift_card', resourceId: card.giftCardId };
        },
        tx,
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid gift card payload', { issues: e.issues }, 400), correlationId);
    // MariaDB 11.8 can expose ER_CHECKREAD (1020) through Prisma's unknown
    // request error during concurrent inserts, rather than the usual P2034.
    if ((e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034')
      || (e instanceof Prisma.PrismaClientUnknownRequestError
        && /code: 1020\b/.test(e.message) && /Record has changed since last read/i.test(e.message))) {
      return errorResponse(new DomainError('CONCURRENT_MODIFICATION', 'Concurrent issuance; retry with the same Idempotency-Key', {}, 409), correlationId);
    }
    if (e instanceof SyntaxError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid JSON payload', {}, 400), correlationId);
    // Neither Prisma arguments nor idempotency's wrapped driver message may reach clients.
    return errorResponse(e instanceof DomainError && e.httpStatus < 500 ? e
      : new DomainError('INTERNAL_ERROR', 'Gift-card issuance failed; retry with the same Idempotency-Key', {}, 500), correlationId);
  }
}
