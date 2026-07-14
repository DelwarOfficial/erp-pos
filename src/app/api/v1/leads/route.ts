// GET  /api/v1/leads  — list leads with today's-actions filter
// POST /api/v1/leads  — create a lead

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const LeadSchema = z.object({
  branch_id: z.string().uuid().optional(),
  status_id: z.string().uuid(),
  subject_id: z.string().uuid().optional(),
  source_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  company_name: z.string().max(200).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(150).optional(),
  estimated_value: z.number().min(0).optional(),
  next_action_at: z.string().datetime().optional(),
  notes: z.string().optional(),
}).refine(d => d.phone || d.email, { message: 'phone or email required' });

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'product.read');
    const url = req.nextUrl;
    const today = url.searchParams.get('today') === 'true';
    const statusId = url.searchParams.get('status_id') ?? undefined;
    const assignedTo = url.searchParams.get('assigned_to') ?? undefined;

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (statusId) where.statusId = statusId;
    if (assignedTo) where.assignedTo = assignedTo;
    if (today) {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(); end.setHours(23, 59, 59, 999);
      where.nextActionAt = { gte: start, lte: end };
    }

    const leads = await db.lead.findMany({
      where, take: 100, orderBy: { nextActionAt: 'asc' },
      include: {
        status: { select: { id: true, name: true, isWon: true, isLost: true, position: true } },
        subject: { select: { id: true, name: true } },
        source: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      items: leads.map(l => ({
        id: l.id, name: l.name, company_name: l.companyName,
        phone: l.phone, email: l.email,
        estimated_value: l.estimatedValue?.toString() ?? null,
        next_action_at: l.nextActionAt,
        notes: l.notes,
        status: l.status, subject: l.subject, source: l.source,
        assignee: l.assignee,
        converted_customer_id: l.convertedCustomerId,
        created_at: l.createdAt,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    const body = LeadSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/leads', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'lead.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const lead = await tx.lead.create({
              data: {
                companyId: auth.companyId,
                branchId: body.branch_id ?? null,
                statusId: body.status_id,
                subjectId: body.subject_id ?? null,
                sourceId: body.source_id ?? null,
                assignedTo: body.assigned_to ?? null,
                name: body.name,
                companyName: body.company_name ?? null,
                phone: body.phone ?? null,
                email: body.email ?? null,
                estimatedValue: body.estimated_value ?? null,
                nextActionAt: body.next_action_at ? new Date(body.next_action_at) : null,
                notes: body.notes ?? null,
                createdBy: auth.userId,
              },
            });
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'lead.create', entityType: 'lead', entityId: lead.id,
                afterValue: JSON.stringify({ name: lead.name }) },
            });
            return { status: 201, body: { id: lead.id, name: lead.name }, resourceType: 'lead', resourceId: lead.id };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid lead payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
