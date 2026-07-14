// src/app/api/v1/feature-flags/[key]/route.ts
// PATCH /api/v1/feature-flags/{key}  — toggle a feature flag
//
// Body: { enabled: boolean, reason?: string }
// Validates:
//   - flag key is in the catalogue (404 otherwise)
//   - if enabling, the underlying module is implemented (409 MODULE_NOT_IMPLEMENTED)
//   - audit log entry created
//   - security event if enabling unimplemented module

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { toggleFeatureFlag, FEATURE_FLAG_CATALOGUE, FeatureFlagKey } from '@/lib/featureFlags';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const ToggleSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'company.update');
    const { key } = await params;

    // Validate key is in catalogue
    const spec = FEATURE_FLAG_CATALOGUE.find(s => s.key === key);
    if (!spec) {
      throw new DomainError('RESOURCE_NOT_FOUND', `Unknown feature flag: ${key}`, {}, 404);
    }

    const idempotencyKey = requireIdempotencyKey(req);
    const body = ToggleSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'PATCH', path: `/api/v1/feature-flags/${key}`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'feature_flag.toggle', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const before = await tx.featureFlag.findUnique({
              where: { companyId_flagKey: { companyId: auth.companyId, flagKey: key as FeatureFlagKey } },
            });
            const toggled = await toggleFeatureFlag({
              companyId: auth.companyId,
              flagKey: key as FeatureFlagKey,
              enabled: body.enabled,
              updatedBy: auth.userId,
              reason: body.reason,
            });

            // Audit (toggleFeatureFlag already wrote the row; we add the audit log)
            await tx.auditLog.create({
              data: {
                companyId: auth.companyId,
                userId: auth.userId,
                correlationId,
                action: 'feature_flag.toggle',
                entityType: 'feature_flag',
                entityId: key,
                beforeValue: JSON.stringify({ enabled: toggled.wasEnabled }),
                afterValue: JSON.stringify({ enabled: toggled.enabled, reason: body.reason }),
              },
            });

            return {
              status: 200,
              body: {
                flag_key: key,
                enabled: toggled.enabled,
                was_enabled: toggled.wasEnabled,
                module: spec.module,
                description: spec.description,
              },
              resourceType: 'feature_flag',
              resourceId: key,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid toggle payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
