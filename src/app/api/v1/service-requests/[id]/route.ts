import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { requireFeatureFlag } from '@/lib/featureFlags';
import { ALLOWED_SERVICE_TRANSITIONS } from '@/domain/commands/m5/Service';
import { updateServiceRequest } from '@/domain/commands/m5/ServiceWorkflow';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateRequest(); await requirePermission(auth, 'service.read'); const { id } = await params;
    const result = await runInTenantContext(auth.ctx, async () => {
      await requireFeatureFlag('service_warranty_enabled');
      const request = await db.serviceRequest.findFirst({ where: { id, companyId: auth.companyId }, include: {
        customer: { select: { id: true, name: true, phone: true } }, branch: { select: { id: true, name: true } }, repairWarehouse: { select: { id: true, name: true } },
        serial: { select: { id: true, serialNumber: true, status: true } }, serviceSale: { select: { id: true, referenceNo: true } },
        parts: { orderBy: { lineNo: 'asc' }, include: { product: { select: { id: true, name: true, code: true } } } },
        events: { orderBy: { createdAt: 'asc' }, include: { creator: { select: { name: true } } } },
      } });
      if (!request) throw new DomainError('RESOURCE_NOT_FOUND', 'Service request not found', {}, 404);
      const approval = await db.approvalRequest.findFirst({ where: { companyId: auth.companyId, referenceType: 'service_request', referenceId: id, requestType: 'service_estimate', status: { in: ['pending', 'approved', 'rejected'] } }, orderBy: { requestedAt: 'desc' }, select: { id: true, status: true, requestedBy: true } });
      return { id: request.id, reference_no: request.referenceNo, status: request.status, service_type: request.serviceType,
        branch: request.branch, warehouse: request.repairWarehouse, customer: request.customer, serial: request.serial, service_sale: request.serviceSale,
        issue: request.issueDescription, intake_condition: request.intakeCondition, accessories: request.accessoriesReceived,
        estimated_amount: request.estimatedAmount.toString(), approved_amount: request.approvedAmount?.toString(), deposit_required: request.depositRequiredAmount.toString(),
        warranty_eligible: request.warrantyEligibleSnapshot, received_at: request.receivedAt, delivered_at: request.deliveredAt, approval,
        available_transitions: (ALLOWED_SERVICE_TRANSITIONS[request.status] ?? []).filter(status => !(status === 'approved' && request.status === 'diagnosing' && request.serviceType !== 'warranty')),
        parts: request.parts.map(part => ({ id: part.id, product: part.product, quantity: part.quantity.toString(), unit_cost: part.unitCostSnapshot.toString(), unit_price: part.unitPrice.toString(), warranty_covered: part.warrantyCovered })),
        events: request.events.map(event => {
          let data: Record<string, unknown> = {}; try { data = JSON.parse(event.eventData); } catch { /* Legacy events still retain their type/time. */ }
          return { id: event.id, type: event.eventType, at: event.createdAt, by: event.creator?.name ?? 'System', note: typeof data.note === 'string' ? data.note : null,
            from: typeof data.from === 'string' ? data.from : null, to: typeof data.to === 'string' ? data.to : null,
            part_count: typeof data.item_count === 'number' ? data.item_count : null, estimate: data.estimated_amount === undefined ? null : String(data.estimated_amount) };
        }),
      };
    });
    return NextResponse.json(result);
  } catch (error) { return errorResponse(error, getCorrelationId(req)); }
}
const schema = z.object({ action: z.enum(['transition', 'diagnosis', 'estimate', 'note', 'link_sale']), status: z.string().max(40).optional(), note: z.string().trim().min(1).max(2000), estimated_amount: z.number().nonnegative().optional(), deposit_required_amount: z.number().nonnegative().optional(), service_sale_id: z.string().uuid().optional() });
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest(); await requirePermission(auth, 'service.complete'); const { id } = await params;
    const body = schema.parse(await req.json()); if (body.action === 'link_sale') await requirePermission(auth, 'sale.read');
    await runInTenantContext(auth.ctx, async () => requireFeatureFlag('service_warranty_enabled'));
    const key = requireIdempotencyKey(req);
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, tx => withIdempotency({ companyId: auth.companyId, userId: auth.userId, idempotencyKey: key, operation: `service_request.${body.action}`, requestHash: computeRequestHash({ method: 'POST', path: `/api/v1/service-requests/${id}`, body }) }, async () => {
      const data = await updateServiceRequest(tx, { companyId: auth.companyId, userId: auth.userId, id, action: body.action, status: body.status, note: body.note, estimatedAmount: body.estimated_amount, depositRequiredAmount: body.deposit_required_amount, serviceSaleId: body.service_sale_id }, correlationId);
      return { status: 200, body: data, resourceType: 'service_request', resourceId: id };
    }, tx)));
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { return errorResponse(error instanceof z.ZodError ? new DomainError('VALIDATION_FAILED', 'Check service action fields', { issues: error.issues }, 400) : error, correlationId); }
}
