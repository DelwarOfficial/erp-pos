import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { LeadInput, leadFields, validateLeadReferences } from '@/lib/api/leadInput';
import { convertLead } from '@/domain/commands/m6/ConvertLead';

type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, { params }: Context) {
  try {
    const auth = await authenticateRequest(); await requirePermission(auth, 'crm.lead.read'); const { id } = await params;
    const lead = await runInTenantContext(auth.ctx, async () => db.lead.findFirst({ where: { id, companyId: auth.companyId }, include: {
      branch: { select: { id: true, name: true, code: true } }, status: true, source: true, subject: true,
      assignee: { select: { id: true, name: true } }, convertedCustomer: { select: { id: true, name: true } },
      activities: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, include: { creator: { select: { name: true } } } },
    } }));
    if (!lead) throw new DomainError('RESOURCE_NOT_FOUND', 'Lead not found', {}, 404);
    return NextResponse.json(lead);
  } catch (error) { return errorResponse(error, getCorrelationId(req)); }
}

export async function POST(req: NextRequest, { params }: Context) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest(); const { id } = await params;
    const envelope = z.object({ action: z.enum(['update', 'convert']), lead: LeadInput.optional() }).parse(await req.json());
    if (envelope.action === 'convert') await requirePermission(auth, 'lead.convert');
    else await requirePermission(auth, 'crm.lead.update');
    const key = requireIdempotencyKey(req);
    if (envelope.action === 'update' && !envelope.lead) throw new DomainError('VALIDATION_FAILED', 'Provide lead details', {}, 400);
    if (envelope.lead?.branch_id) await requirePermission(auth, 'crm.lead.update', envelope.lead.branch_id);
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, tx => withIdempotency({ companyId: auth.companyId, userId: auth.userId,
      idempotencyKey: key, operation: 'lead.' + envelope.action, requestHash: computeRequestHash({ method: 'POST', path: '/api/v1/leads/' + id, body: envelope }),
    }, async () => {
      const before = await tx.lead.findFirst({ where: { id, companyId: auth.companyId } });
      if (!before) throw new DomainError('RESOURCE_NOT_FOUND', 'Lead not found', {}, 404);
      if (envelope.action === 'convert') return { status: 200, body: await convertLead(tx, { companyId: auth.companyId, leadId: id, convertedBy: auth.userId }, correlationId), resourceType: 'lead', resourceId: id };
      const body = envelope.lead!; const status = await validateLeadReferences(tx, auth.companyId, body);
      if (before.convertedCustomerId && status.id !== before.statusId) throw new DomainError('VALIDATION_FAILED', 'Converted leads retain their won status', {}, 409);
      await tx.lead.update({ where: { id }, data: { ...leadFields(body, status.id), updatedAt: new Date() } });
      await tx.leadActivity.create({ data: { companyId: auth.companyId, leadId: id, activityType: before.statusId === status.id ? 'note' : 'status_change', summary: 'Lead updated: ' + status.name, details: body.notes, createdBy: auth.userId } });
      await tx.auditLog.create({ data: { companyId: auth.companyId, userId: auth.userId, correlationId, action: 'lead.update', entityType: 'lead', entityId: id,
        beforeValue: JSON.stringify({ name: before.name, status_id: before.statusId, branch_id: before.branchId }), afterValue: JSON.stringify({ name: body.name, status_id: status.id, branch_id: body.branch_id ?? before.branchId }) } });
      return { status: 200, body: { id, name: body.name }, resourceType: 'lead', resourceId: id };
    }, tx)));
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid lead details', { issues: error.issues }, 400), correlationId);
    return errorResponse(error, correlationId);
  }
}
