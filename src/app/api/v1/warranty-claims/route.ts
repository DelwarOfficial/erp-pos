// POST /api/v1/warranty-claims — create a warranty claim

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { validateWarrantyReplacement } from '@/domain/commands/m5/Service';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const WarrantyClaimSchema = z.object({
  service_request_id: z.string().uuid(),
  claim_type: z.enum(['repair', 'replace', 'refund', 'supplier_claim']),
  eligibility_reason: z.string().min(1).max(2000),
  replacement_serial_id: z.string().uuid().optional(),
  supplier_reference: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'warranty.fulfill');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = WarrantyClaimSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/warranty-claims', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'warranty_claim.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // Validate service request exists
            const sr = await tx.serviceRequest.findFirst({
              where: { id: body.service_request_id, companyId: auth.companyId },
            });
            if (!sr) throw new DomainError('RESOURCE_NOT_FOUND', 'Service request not found', {}, 404);

            // If replacement, validate the replacement serial
            if (body.replacement_serial_id) {
              const serial = await tx.productSerial.findFirst({
                where: { id: body.replacement_serial_id, companyId: auth.companyId },
              });
              if (!serial) throw new DomainError('RESOURCE_NOT_FOUND', 'Replacement serial not found', {}, 404);
              validateWarrantyReplacement(serial);
            }

            const claim = await tx.warrantyClaim.create({
              data: {
                companyId: auth.companyId,
                serviceRequestId: body.service_request_id,
                claimType: body.claim_type,
                status: 'submitted',
                eligibilityReason: body.eligibility_reason,
                replacementSerialId: body.replacement_serial_id ?? null,
                supplierReference: body.supplier_reference ?? null,
              },
            });

            await tx.auditLog.create({
              data: {
                companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'warranty_claim.create', entityType: 'warranty_claim', entityId: claim.id,
                afterValue: JSON.stringify({
                  service_request: body.service_request_id,
                  claim_type: body.claim_type,
                  replacement_serial: body.replacement_serial_id ?? null,
                }),
              },
            });

            return {
              status: 201,
              body: { id: claim.id, status: claim.status, claim_type: claim.claimType },
              resourceType: 'warranty_claim', resourceId: claim.id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid warranty claim payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
