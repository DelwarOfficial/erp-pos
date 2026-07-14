// GET  /api/v1/service-requests  — list service requests
// POST /api/v1/service-requests  — create service request (intake)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { requireFeatureFlag } from '@/lib/featureFlags';
import { createServiceRequest, postServicePartConsumption } from '@/domain/commands/m5/Service';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const ServiceRequestSchema = z.object({
  branch_id: z.string().uuid(),
  repair_warehouse_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  sale_id: z.string().uuid().optional(),
  serial_id: z.string().uuid().optional(),
  service_type: z.enum(['warranty', 'paid_repair', 'installation', 'inspection']),
  issue_description: z.string().min(1),
  intake_condition: z.string().optional(),
  accessories_received: z.string().optional(),
  estimated_amount: z.number().min(0).default(0),
  deposit_required_amount: z.number().min(0).default(0),
});

const ConsumePartsSchema = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().positive(),
    unit_price: z.number().min(0),
    warranty_covered: z.boolean().default(false),
  })).min(1),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'service.intake');
  await requirePermission(auth, 'inventory.read');
    const status = req.nextUrl.searchParams.get('status') ?? undefined;
    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.status = status;

    const requests = await db.serviceRequest.findMany({
      where, take: 50, orderBy: { receivedAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        serial: { select: { id: true, serialNumber: true } },
        _count: { select: { parts: true, events: true } },
      },
    });
    return NextResponse.json({
      items: requests.map(r => ({
        id: r.id, reference_no: r.referenceNo, status: r.status,
        service_type: r.serviceType,
        customer: r.customer, serial: r.serial,
        issue_description: r.issueDescription,
        estimated_amount: r.estimatedAmount.toString(),
        warranty_eligible: r.warrantyEligibleSnapshot,
        received_at: r.receivedAt, delivered_at: r.deliveredAt,
        part_count: r._count.parts, event_count: r._count.events,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requireFeatureFlag('service_warranty_enabled');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = ServiceRequestSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/service-requests', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'service_request.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const result = await createServiceRequest(tx, {
              companyId: auth.companyId, branchId: body.branch_id,
              repairWarehouseId: body.repair_warehouse_id,
              customerId: body.customer_id, saleId: body.sale_id,
              serialId: body.serial_id,
              serviceType: body.service_type,
              issueDescription: body.issue_description,
              intakeCondition: body.intake_condition,
              accessoriesReceived: body.accessories_received,
              estimatedAmount: body.estimated_amount,
              depositRequiredAmount: body.deposit_required_amount,
              createdBy: auth.userId,
            }, correlationId);
            return { status: 201, body: result, resourceType: 'service_request', resourceId: result.serviceRequestId };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid service request payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
