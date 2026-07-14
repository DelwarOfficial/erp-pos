// GET  /api/v1/gift-cards  — list gift cards
// POST /api/v1/gift-cards  — issue a gift card

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { randomBytes } from 'node:crypto';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { requireFeatureFlag } from '@/lib/featureFlags';

const GiftCardSchema = z.object({
  face_value: z.number().positive(),
  expires_at: z.string().datetime().optional(),
});

function generateGiftCardCode(): string {
  return 'GC-' + randomBytes(8).toString('hex').toUpperCase();
}

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'gift_card.issue');
  await requirePermission(auth, 'product.read');
    const cards = await db.giftCard.findMany({
      where: { companyId: auth.companyId },
      take: 50, orderBy: { issuedAt: 'desc' },
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
    const idempotencyKey = requireIdempotencyKey(req);
    const body = GiftCardSchema.parse(await req.json());
    await requireFeatureFlag('loyalty_enabled');
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/gift-cards', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'gift_card.issue', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const code = generateGiftCardCode();
            const card = await tx.giftCard.create({
              data: {
                companyId: auth.companyId,
                code,
                faceValue: body.face_value,
                status: 'active',
                expiresAt: body.expires_at ? new Date(body.expires_at) : null,
                issuedBy: auth.userId,
              },
            });
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'gift_card.issue', entityType: 'gift_card', entityId: card.id,
                afterValue: JSON.stringify({ code, face_value: body.face_value }) },
            });
            return { status: 201, body: { id: card.id, code, face_value: body.face_value }, resourceType: 'gift_card', resourceId: card.id };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid gift card payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
