// GET  /api/v1/webhook-endpoints  — list webhook endpoints
// POST /api/v1/webhook-endpoints  — create a webhook endpoint (HTTPS-only)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { generateWebhookSecret } from '@/lib/integrations/webhook';
import { encryptString } from '@/lib/crypto';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const WebhookSchema = z.object({
  url: z.string().url().regex(/^https:\/\//, 'URL must start with https://'),
  subscribed_events: z.array(z.string()).min(1),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'company.update');
  await requirePermission(auth, 'company.read');
    const endpoints = await db.webhookEndpoint.findMany({
      where: { companyId: auth.companyId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { deliveries: true } } },
    });
    return NextResponse.json({
      items: endpoints.map(e => ({
        id: e.id, url: e.url, status: e.status,
        subscribed_events: JSON.parse(e.subscribedEvents),
        delivery_count: e._count.deliveries,
        created_at: e.createdAt,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    const body = WebhookSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/webhook-endpoints', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'webhook_endpoint.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // Check URL uniqueness
            const existing = await tx.webhookEndpoint.findFirst({
              where: { companyId: auth.companyId, url: body.url },
            });
            if (existing) throw new DomainError('VALIDATION_FAILED', 'Webhook URL already exists', {}, 409);

            // Generate secret + encrypt
            const secret = generateWebhookSecret();
            const enc = encryptString(secret);

            const endpoint = await tx.webhookEndpoint.create({
              data: {
                companyId: auth.companyId,
                url: body.url,
                secretCiphertext: new Uint8Array(enc.ciphertext),
                subscribedEvents: JSON.stringify(body.subscribed_events),
                status: 'active',
                createdBy: auth.userId,
              },
            });

            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'webhook_endpoint.create', entityType: 'webhook_endpoint', entityId: endpoint.id,
                afterValue: JSON.stringify({ url: body.url, events: body.subscribed_events }) },
            });

            return {
              status: 201,
              body: { id: endpoint.id, url: body.url, status: 'active', secret_shown_once: secret },
              resourceType: 'webhook_endpoint', resourceId: endpoint.id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid webhook payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
