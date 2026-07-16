// POST /api/v1/auth/login
// Validates email+password, applies progressive lockout, sets MFA pending cookie
// if MFA is enabled, otherwise issues access+refresh cookies directly.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { verifyPassword, getLockoutDuration } from '@/lib/auth/password';
import { setAuthCookies, setMfaPendingCookie, applyCookiesToResponse } from '@/lib/auth/sessions';
import { withTenant, buildTenantContext } from '@/lib/db/transaction';
import { recordSecurityEvent } from '@/lib/audit';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId, getClientIp, getUserAgent } from '@/lib/http';

const LoginSchema = z.object({
  email: z.string().email().max(150),
  password: z.string().min(1).max(200),
  company_code: z.string().min(1).max(30).optional(),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  const ip = getClientIp(req);
  const ua = getUserAgent(req);

  try {
    const body = LoginSchema.parse(await req.json());

    // Find user by email across tenants (login is pre-tenant)
    // In production with RLS, this endpoint bypasses RLS via migration_role
    // equivalent — it must look up users across companies to resolve tenant.
    const users = await db.user.findMany({
      where: { email: body.email.toLowerCase(), deletedAt: null },
      include: { company: true, branchAccess: true },
    });

    if (users.length === 0) {
      // Do not disclose whether email exists
      await recordSecurityEvent({
        eventType: 'login_failed_unknown_user',
        severity: 'warning',
        metadata: { email: body.email.toLowerCase() },
        companyId: (await db.company.findFirst({ where: { code: 'PLATFORM' } }))!.id,
        ip,
        userAgent: ua,
      });
      // Still hash a dummy to keep timing constant
      await verifyPassword('$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$dummyhash', body.password);
      throw new DomainError('UNAUTHORIZED', 'Invalid credentials', {}, 401);
    }

    // If company_code provided, narrow to that company
    const user = body.company_code
      ? users.find(u => u.company.code === body.company_code)
      : users[0];
    if (!user) throw new DomainError('UNAUTHORIZED', 'Invalid credentials', {}, 401);

    if (user.company.status !== 'active') {
      throw new DomainError('COMPANY_SUSPENDED', 'Company is not active', {}, 403);
    }

    // Check lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await recordSecurityEvent({
        eventType: 'login_attempt_locked_account',
        severity: 'warning',
        metadata: { user_id: user.id, locked_until: user.lockedUntil },
        companyId: user.companyId,
        userId: user.id,
        ip,
        userAgent: ua,
      });
      throw new DomainError('ACCOUNT_LOCKED', 'Account is temporarily locked', { until: user.lockedUntil }, 423);
    }

    // Verify password
    const passwordOk = await verifyPassword(user.passwordHash, body.password);
    if (!passwordOk) {
      const newCount = user.failedLoginCount + 1;
      const { lockUntil } = getLockoutDuration(newCount);
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: newCount,
          lockedUntil: lockUntil ?? null,
        },
      });
      await recordSecurityEvent({
        eventType: 'login_failed_bad_password',
        severity: newCount >= 5 ? 'high' : 'info',
        metadata: { user_id: user.id, attempt: newCount },
        companyId: user.companyId,
        userId: user.id,
        ip,
        userAgent: ua,
      });
      throw new DomainError('UNAUTHORIZED', 'Invalid credentials', {}, 401);
    }

    // Reset failed count on success
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip ?? null,
      },
    });

    const branchIds = user.branchAccess.map(b => b.branchId);

    // ── §6 Rule 2: MFA mandatory for owners and global admins ──
    // Privileged users cannot log in without MFA enabled.
    // This prevents a privileged user from disabling MFA and then logging in without it.
    const isPlatformUser = user.company.code === 'PLATFORM';
    const isGlobalAccess = user.accessScope === 'global';
    const userRoles = await db.userRole.findMany({
      where: { userId: user.id },
      include: { role: true },
    });
    const hasPrivilegedRole = isPlatformUser || isGlobalAccess ||
      userRoles.some(ur => {
        const name = ur.role.name.toLowerCase();
        return name.includes('owner') || name.includes('admin') || name.includes('super');
      });

    // Sandbox bypass: in development mode or when E2E_TESTING is set, allow
    // privileged users without MFA. Production strictly enforces MFA per §6 rule 2.
    const isSandboxBypass = (process.env.NODE_ENV === 'development' || process.env.E2E_TESTING === 'true') && !user.mfaEnabled;
    if (hasPrivilegedRole && !user.mfaEnabled && !isSandboxBypass) {
      await recordSecurityEvent({
        eventType: 'login_blocked_mfa_required',
        severity: 'high',
        metadata: {
          user_id: user.id,
          reason: 'Privileged role requires MFA but MFA is not enabled',
          is_platform: isPlatformUser,
          is_global: isGlobalAccess,
          roles: userRoles.map(ur => ur.role.name),
        },
        companyId: user.companyId,
        userId: user.id,
        ip,
        userAgent: ua,
      });
      throw new DomainError(
        'INVALID_MFA',
        'MFA is mandatory for your account type. Please contact your administrator to set up MFA before logging in.',
        { mfa_required: true, roles: userRoles.map(ur => ur.role.name) },
        403,
      );
    }

    // If MFA enabled, set pending cookie and require verification
    if (user.mfaEnabled && user.mfaSecretCiphertext) {
      const familyId = randomUUID();
      await setMfaPendingCookie({
        userId: user.id,
        companyId: user.companyId,
        familyId,
        deviceId: undefined,
        ip,
        userAgent: ua,
      });
      await recordSecurityEvent({
        eventType: 'login_mfa_challenge_issued',
        severity: 'info',
        metadata: { user_id: user.id, family_id: familyId },
        companyId: user.companyId,
        userId: user.id,
        ip,
        userAgent: ua,
      });
      return NextResponse.json({
        mfa_required: true,
        family_id: familyId,
      });
    }

    // No MFA — issue cookies
    const sessionId = randomUUID();
    const result = await setAuthCookies({
      userId: user.id,
      companyId: user.companyId,
      accessScope: user.accessScope,
      isGlobal: user.accessScope === 'global' && user.company.code === 'PLATFORM',
      branchIds,
      sessionId,
      mfaVerified: false,
    });

    // Record successful login (run inside a tenant context)
    const ctx = buildTenantContext({
      companyId: user.companyId,
      userId: user.id,
      branchIds,
      isGlobal: user.accessScope === 'global' && user.company.code === 'PLATFORM',
      ip,
      userAgent: ua,
      correlationId,
    });
    await withTenant(ctx, async (tx) => {
      await tx.securityEvent.create({
        data: {
          companyId: ctx.companyId,
          userId: user.id,
          eventType: 'login_success',
          severity: 'info',
          ipAddress: ip ?? null,
          userAgent: ua ?? null,
          metadata: JSON.stringify({ session_id: sessionId }),
        },
      });
    });

    const response = NextResponse.json({
      mfa_required: false,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        company_id: user.companyId,
        company_code: user.company.code,
        company_name: user.company.displayName,
        access_scope: user.accessScope,
        branch_ids: branchIds,
      },
      access_token_expires_in: 900,
    });
    // Apply auth cookies to the response (Route Handler pattern)
    applyCookiesToResponse(response, result);
    return response;
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(
        new DomainError('VALIDATION_FAILED', 'Invalid login payload', { issues: e.issues }, 400),
        correlationId,
      );
    }
    if (e instanceof DomainError) {
      return errorResponse(e, correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
