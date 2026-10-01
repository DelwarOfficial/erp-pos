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

import { LeadInput, leadFields, validateLeadReferences } from '@/lib/api/leadInput';
import { readListPage, listPageArgs, listPageResult } from '@/lib/api/listPage';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, "crm.lead.read");
    const url = req.nextUrl;
    const page = readListPage(url);
    const search = url.searchParams.get('search')?.trim();
    const today = url.searchParams.get('today') === 'true';
    const statusId = url.searchParams.get('status_id') ?? undefined;
    const assignedTo = url.searchParams.get('assigned_to') ?? undefined;

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (search) where.OR = [{ name: { contains: search } }, { companyName: { contains: search } }, { phone: { contains: search } }];
    if (statusId) where.statusId = statusId;
    if (assignedTo) where.assignedTo = assignedTo;
    if (today) {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(); end.setHours(23, 59, 59, 999);
      where.nextActionAt = { gte: start, lte: end };
    }

    const leads = await runInTenantContext(auth.ctx, async () => {
      return db.lead.findMany({
        where, ...listPageArgs(page), orderBy: [{ nextActionAt: 'asc' }, { id: 'asc' }],
        include: {
          status: { select: { id: true, name: true, isWon: true, isLost: true, position: true } },
          subject: { select: { id: true, name: true } },
          source: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true } },
        },
      });
    });

    return NextResponse.json({
      ...listPageResult(leads, page),
      items: listPageResult(leads, page).items.map(l => ({
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
    await requirePermission(auth, "crm.lead.create");
    const idempotencyKey = requireIdempotencyKey(req);
    const body = LeadInput.parse(await req.json());
    if (body.branch_id) await requirePermission(auth, 'crm.lead.create', body.branch_id);
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/leads', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async (tx) =>
        withIdempotency(
          { idempotencyKey, operation: 'lead.create', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const status = await validateLeadReferences(tx, auth.companyId, body);
            const lead = await tx.lead.create({
              data: {
                companyId: auth.companyId,
                ...leadFields(body, status.id),
                createdBy: auth.userId,
              },
            });
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'lead.create', entityType: 'lead', entityId: lead.id,
                afterValue: JSON.stringify({ name: lead.name }) },
            });
            return { status: 201, body: { id: lead.id, name: lead.name }, resourceType: 'lead', resourceId: lead.id };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid lead payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
