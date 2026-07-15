// POST /api/v1/onboarding
// Platform_operations-only endpoint. Seeds company+branch+warehouse+admin+
// role+policies+CoA skeleton+base currency+initial fiscal period in one
// transaction. Status='suspended' until admin setup. Activate via platform ops.
// Per §20.D01 — administrator-led company onboarding (no public signup).

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { runInTenantContext } from '@/lib/db/transaction';
import { hashPassword } from '@/lib/auth/password';
import { SYSTEM_ROLES, PERMISSIONS } from '@/lib/permissions/catalogue';
import { seedFeatureFlagsForCompany } from '@/lib/featureFlags';
import { seedLocalizationForCompany, DEFAULT_LOCALE } from '@/lib/i18n';
import { seedDefaultCoa } from '@/lib/accounting/seedCoa';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId, getClientIp, getUserAgent } from '@/lib/http';

const OnboardSchema = z.object({
  company: z.object({
    legal_name: z.string().min(1).max(200),
    display_name: z.string().min(1).max(200),
    code: z.string().min(2).max(30).regex(/^[A-Z0-9_-]+$/),
    base_currency_code: z.string().length(3).default('BDT'),
    timezone: z.string().max(64).default('Asia/Dhaka'),
    country_code: z.string().length(2).default('BD'),
    default_locale: z.enum(['bn-BD', 'en-BD']).default('bn-BD'),
    bin: z.string().max(30).optional(),
    tin: z.string().max(30).optional(),
    vat_registered: z.boolean().default(false),
    fiscal_year_start_month: z.number().int().min(1).max(12).default(7),
  }),
  branch: z.object({
    name: z.string().min(1).max(200),
    code: z.string().min(1).max(20),
    phone: z.string().max(30).optional(),
    email: z.string().email().max(150).optional(),
    address: z.string().optional(),
  }),
  warehouse: z.object({
    name: z.string().min(1).max(200),
    code: z.string().min(1).max(30),
    warehouse_type: z.enum(['retail', 'central', 'repair', 'damaged', 'transit']).default('retail'),
  }),
  admin_user: z.object({
    name: z.string().min(1).max(120),
    email: z.string().email().max(150),
    password: z.string().min(12).max(200),
    phone: z.string().max(30).optional(),
  }),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  const ip = getClientIp(req);
  const ua = getUserAgent(req);

  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'platform.onboarding.execute');

    // Only platform_operations can onboard new tenants
    if (!auth.isGlobal || !(await hasPlatformOnboardPermission(auth.userId))) {
      throw new DomainError(
        'FORBIDDEN_SCOPE',
        'Only platform_operations may onboard new tenants',
        {},
        403,
      );
    }

    const idempotencyKey = requireIdempotencyKey(req);
    const body = OnboardSchema.parse(await req.json());
    const requestHash = computeRequestHash({
      method: req.method,
      path: req.nextUrl.pathname,
      body,
    });

    const result = await runInTenantContext(auth.ctx, async () => {
      return withIdempotency(
        {
          idempotencyKey,
          operation: 'onboarding.create',
          requestHash,
          companyId: auth.companyId,
          userId: auth.userId,
        },
        async () => {
          // Run inside a transaction — all-or-nothing
          return db.$transaction(async (tx) => {
          // Check company code is unique
          const existing = await tx.company.findUnique({ where: { code: body.company.code } });
          if (existing) {
            throw new DomainError('VALIDATION_FAILED', `Company code "${body.company.code}" already exists`, {}, 409);
          }

          // 1. Create company in suspended status
          const company = await tx.company.create({
            data: {
              legalName: body.company.legal_name,
              displayName: body.company.display_name,
              code: body.company.code,
              baseCurrencyCode: body.company.base_currency_code,
              timezone: body.company.timezone,
              countryCode: body.company.country_code,
              defaultLocale: body.company.default_locale,
              bin: body.company.bin ?? null,
              tin: body.company.tin ?? null,
              vatRegistered: body.company.vat_registered,
              fiscalYearStartMonth: body.company.fiscal_year_start_month,
              status: 'suspended', // until admin completes setup
            },
          });

          // 2. Create branch
          const branch = await tx.branch.create({
            data: {
              companyId: company.id,
              name: body.branch.name,
              code: body.branch.code,
              phone: body.branch.phone ?? null,
              email: body.branch.email ?? null,
              address: body.branch.address ?? null,
              isActive: true,
            },
          });

          // 3. Create warehouse
          const warehouse = await tx.warehouse.create({
            data: {
              companyId: company.id,
              branchId: branch.id,
              name: body.warehouse.name,
              code: body.warehouse.code,
              warehouseType: body.warehouse.warehouse_type,
              isActive: true,
            },
          });

          // 4. Seed system roles for this tenant
          const roleMap = new Map<string, string>();
          for (const spec of SYSTEM_ROLES.filter(r => r.name !== 'platform_operations')) {
            const role = await tx.role.create({
              data: {
                companyId: company.id,
                name: spec.name,
                description: spec.description,
                isSystemRole: true,
              },
            });
            roleMap.set(spec.name, role.id);

            const perms = (spec.permissions as readonly string[]).includes('*')
              ? PERMISSIONS
              : (spec.permissions as readonly string[]).flatMap(p =>
                  p.endsWith('.*')
                    ? PERMISSIONS.filter(x => x.code.startsWith(p.slice(0, -1)))
                    : PERMISSIONS.filter(x => x.code === p),
                );

            for (const p of perms) {
              const perm = await tx.permission.findUnique({ where: { code: p.code } });
              if (!perm) continue;
              await tx.rolePermission.create({
                data: { roleId: role.id, permissionId: perm.id },
              });
            }
          }

          // 5. Create admin user with owner role
          const hash = await hashPassword(body.admin_user.password);
          const admin = await tx.user.create({
            data: {
              companyId: company.id,
              name: body.admin_user.name,
              email: body.admin_user.email.toLowerCase(),
              phone: body.admin_user.phone ?? null,
              passwordHash: hash,
              primaryBranchId: branch.id,
              accessScope: 'global',
              isActive: true,
            },
          });
          await tx.userBranchAccess.create({
            data: { userId: admin.id, branchId: branch.id },
          });

          const ownerRoleId = roleMap.get('owner');
          if (!ownerRoleId) throw new DomainError('INTERNAL_ERROR', 'Owner role not seeded', {}, 500);
          await tx.userRole.create({
            data: { userId: admin.id, roleId: ownerRoleId },
          });

          // 6. Audit log (manual — outside withTenant but inside tx)
          await tx.auditLog.create({
            data: {
              companyId: company.id,
              userId: auth.userId,
              correlationId,
              action: 'onboarding.create',
              entityType: 'company',
              entityId: company.id,
              beforeValue: null,
              afterValue: JSON.stringify({
                company_code: company.code,
                branch_code: branch.code,
                warehouse_code: warehouse.code,
                admin_email: admin.email,
              }),
              clientIp: ip ?? null,
              userAgent: ua ?? null,
            },
          });

          // 7. Seed M1 defaults: feature flags + localization
          await seedFeatureFlagsForCompany(company.id, admin.id);
          await seedLocalizationForCompany(company.id, body.company.default_locale as typeof DEFAULT_LOCALE || DEFAULT_LOCALE);

          // 8. Seed default chart of accounts + accounting policies + financial accounts
          const coaResult = await seedDefaultCoa(tx, company.id);

          return {
            status: 201,
            body: {
              company_id: company.id,
              company_code: company.code,
              status: company.status,
              branch_id: branch.id,
              warehouse_id: warehouse.id,
              admin_user_id: admin.id,
              admin_user_email: admin.email,
              cash_account_id: coaResult.financialAccountIds.cash,
              bank_account_id: coaResult.financialAccountIds.bank,
              mobile_wallet_account_id: coaResult.financialAccountIds.mobileWallet,
              coa_account_count: Object.keys(coaResult.chartOfAccounts).length,
              next_step: 'platform_operations must activate the company via POST /api/v1/onboarding/{id}/activate after admin sets up MFA and password',
            },
            resourceType: 'company',
            resourceId: company.id,
          };
          });
        },
      );
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(
        new DomainError('VALIDATION_FAILED', 'Invalid onboarding payload', { issues: e.issues }, 400),
        correlationId,
      );
    }
    if (e instanceof DomainError) return errorResponse(e, correlationId);
    return errorResponse(e, correlationId);
  }
}

async function hasPlatformOnboardPermission(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!user) return false;
  return user.roles.some(ur =>
    ur.role.permissions.some(rp => rp.permission.code === 'platform.onboarding.execute'),
  );
}
