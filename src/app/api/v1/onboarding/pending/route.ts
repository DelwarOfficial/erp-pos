// GET /api/v1/onboarding/pending
// Platform_operations-only: lists companies awaiting activation (suspended),
// with the owner admin's MFA readiness, so the platform team can activate
// them from the dashboard instead of tracking them down another way.

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { accessResponse, accessError } from '@/lib/access/http';
import { DomainError } from '@/lib/errors/codes';

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'platform.onboarding.execute');
    if (!auth.isGlobal) {
      throw new DomainError(
        'FORBIDDEN_SCOPE',
        'Only platform_operations may list pending companies',
        {},
        403,
      );
    }
    const companies = await runInTenantContext(auth.ctx, async () => {
      return db.company.findMany({
        where: { status: 'suspended' },
        select: {
          id: true,
          displayName: true,
          code: true,
          createdAt: true,
          users: {
            where: { isActive: true, deletedAt: null },
            select: {
              id: true,
              name: true,
              email: true,
              mfaEnabled: true,
              roles: { select: { role: { select: { name: true } } } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
    const data = companies.map((company) => {
      const owners = company.users.filter((u) =>
        u.roles.some((r) => r.role.name === 'owner'),
      );
      const owner = owners[0] ?? company.users[0] ?? null;
      return {
        id: company.id,
        display_name: company.displayName,
        code: company.code,
        created_at: company.createdAt.toISOString(),
        admin_name: owner?.name ?? null,
        admin_email: owner?.email ?? null,
        owner_mfa_enabled: owners.some((u) => u.mfaEnabled),
        owner_count: owners.length,
      };
    });
    return accessResponse({ data });
  } catch (error) {
    return accessError(error);
  }
}
