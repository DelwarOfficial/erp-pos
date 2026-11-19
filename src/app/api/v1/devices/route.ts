// GET  /api/v1/devices  — this company's registered tills (device.read)
// POST /api/v1/devices  — register this browser as a till for offline sales (device.register)
//   { label, branch_id, device_key }
// device_key is a random id the browser makes and keeps; it identifies the
// till, it is not a secret. A registered till is active at once; revoking one
// stops its bootstrap and sync.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { requireFeatureFlag } from '@/lib/featureFlags';
import { getCorrelationId } from '@/lib/http';

const RegisterSchema = z.object({
  label: z.string().trim().min(1).max(80),
  branch_id: z.string().uuid(),
  device_key: z.string().uuid(),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'device.read');
    const items = await runInTenantContext(auth.ctx, () => db.device.findMany({
      where: { companyId: auth.companyId }, orderBy: { createdAt: 'desc' }, take: 200,
      select: { id: true, label: true, status: true, lastSeenAt: true, lastBootstrapAt: true, createdAt: true, branch: { select: { id: true, name: true } } },
    }));
    return NextResponse.json({ items: items.map(d => ({ id: d.id, label: d.label, status: d.status, branch: d.branch,
      last_seen_at: d.lastSeenAt, last_bootstrap_at: d.lastBootstrapAt, created_at: d.createdAt })) });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'device.register');
    await runInTenantContext(auth.ctx, () => requireFeatureFlag('offline_pos_enabled'));
    const idempotencyKey = requireIdempotencyKey(req);
    const body = RegisterSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/devices', body });
    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async tx =>
        withIdempotency(
          { idempotencyKey, operation: 'device.register', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const branch = await tx.branch.findFirst({ where: { id: body.branch_id, companyId: auth.companyId }, select: { id: true } });
            if (!branch) throw new DomainError('RESOURCE_NOT_FOUND', 'Branch not found', {}, 404);
            if (!auth.ctx.allBranches && !auth.ctx.branchIds.includes(body.branch_id)) {
              throw new DomainError('FORBIDDEN_SCOPE','You cannot register a till for this branch', {}, 403);
            }
            if (await tx.device.findFirst({ where: { devicePublicKey: body.device_key }, select: { id: true } })) {
              throw new DomainError('VALIDATION_FAILED', 'This till is already registered', {}, 409);
            }
            // Till names are unique per branch (devices_company_id_branch_id_label_key).
            if (await tx.device.findFirst({ where: { companyId: auth.companyId, branchId: body.branch_id, label: body.label }, select: { id: true } })) {
              throw new DomainError('VALIDATION_FAILED', `A till called "${body.label}" already exists in this branch. Choose another name.`, {}, 409);
            }
            const device = await tx.device.create({ data: { companyId: auth.companyId, branchId: body.branch_id, label: body.label,
              devicePublicKey: body.device_key, registeredBy: auth.userId!, status: 'active', lastSeenAt: new Date() } });
            await tx.auditLog.create({ data: { companyId: auth.companyId, userId: auth.userId, correlationId,
              action: 'device.register', entityType: 'device', entityId: device.id, afterValue: JSON.stringify({ label: body.label, branch_id: body.branch_id }) } });
            return { status: 201, body: { id: device.id, label: device.label, branch_id: device.branchId, status: device.status }, resourceType: 'device', resourceId: device.id };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid till details', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
