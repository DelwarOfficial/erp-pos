// POST /api/v1/onboarding/{id}/activate
// Platform_operations-only: marks a suspended company as active.
// Per §20.D01 step 6: "platform operations team marks it active after verification."

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'platform.onboarding.execute');

    // Only platform_operations can activate
    if (!auth.isGlobal) {
      throw new DomainError(
        'FORBIDDEN_SCOPE',
        'Only platform_operations may activate a tenant',
        {},
        403,
      );
    }

    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const requestHash = computeRequestHash({
      method: 'POST',
      path: `/api/v1/onboarding/${id}/activate`,
      body: { id },
    });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'company.activate', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const company = await tx.company.findUnique({ where: { id } });
            if (!company) {
              throw new DomainError('RESOURCE_NOT_FOUND', 'Company not found', {}, 404);
            }
            if (company.status === 'active') {
              return {
                status: 200,
                body: { id: company.id, code: company.code, status: 'already_active' },
                resourceType: 'company',
                resourceId: company.id,
              };
            }
            if (company.status === 'closed') {
              throw new DomainError(
                'VALIDATION_FAILED',
                'Cannot activate a closed company',
                { current_status: company.status },
                409,
              );
            }

            // Verify the company has at least one admin user with MFA enabled
            // (per §20.D01 step 5: "admin user sets their password, enables MFA")
            const adminUsers = await tx.user.findMany({
              where: { companyId: company.id, isActive: true, deletedAt: null },
              include: { roles: { include: { role: true } } },
            });
            if (adminUsers.length === 0) {
              throw new DomainError(
                'VALIDATION_FAILED',
                'Cannot activate: company has no active admin users',
                {},
                409,
              );
            }
            const ownersWithMfa = adminUsers.filter(u =>
              u.roles.some(ur => ur.role.name === 'owner') && u.mfaEnabled
            );
            if (ownersWithMfa.length === 0) {
              throw new DomainError(
                'VERIFICATION_REQUIRED',
                'Cannot activate: at least one owner must have MFA enabled',
                { admin_count: adminUsers.length, owners_with_mfa: 0 },
                409,
              );
            }

            // Activate
            const updated = await tx.company.update({
              where: { id },
              data: { status: 'active' },
            });

            await tx.auditLog.create({
              data: {
                companyId: company.id,
                userId: auth.userId,
                correlationId,
                action: 'company.activate',
                entityType: 'company',
                entityId: company.id,
                beforeValue: JSON.stringify({ status: 'suspended' }),
                afterValue: JSON.stringify({ status: 'active' }),
              },
            });

            return {
              status: 200,
              body: {
                id: updated.id,
                code: updated.code,
                status: updated.status,
                activated_at: new Date().toISOString(),
              },
              resourceType: 'company',
              resourceId: updated.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
