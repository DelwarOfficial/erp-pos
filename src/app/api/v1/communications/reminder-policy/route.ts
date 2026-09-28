// GET /api/v1/communications/reminder-policy — the company's due reminder policy.
// PUT /api/v1/communications/reminder-policy — change it (audited).
// See src/domain/receivables/reminderPolicy.ts.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { parseStageOffsets } from '@/domain/receivables/reminderPolicy';

const DEFAULTS = { enabled: false, stage_offsets: [-3, -1, 0, 1, 3, 7], send_window_start_minute: 540, send_window_end_minute: 1200,
  min_outstanding: '1.00', max_per_customer_per_day: 1, daily_company_limit: 500, locale: 'bn' };

const PolicySchema = z.object({
  enabled: z.boolean(),
  stage_offsets: z.array(z.number().int()).min(1).max(12),
  send_window_start_minute: z.number().int().min(0).max(1439),
  send_window_end_minute: z.number().int().min(1).max(1440),
  min_outstanding: z.string().regex(/^\d{1,15}(\.\d{1,2})?$/),
  max_per_customer_per_day: z.number().int().min(1).max(10),
  daily_company_limit: z.number().int().min(0).max(100_000),
  locale: z.enum(['bn', 'en']),
}).refine(p => p.send_window_start_minute < p.send_window_end_minute, { message: 'The sending window must start before it ends' });

function present(row: { enabled: boolean; stageOffsets: string; sendWindowStartMinute: number; sendWindowEndMinute: number;
  minOutstanding: { toFixed(n: number): string }; maxPerCustomerPerDay: number; dailyCompanyLimit: number; locale: string; updatedAt: Date } | null) {
  if (!row) return { ...DEFAULTS, configured: false };
  return {
    configured: true, enabled: row.enabled, stage_offsets: parseStageOffsets(row.stageOffsets),
    send_window_start_minute: row.sendWindowStartMinute, send_window_end_minute: row.sendWindowEndMinute,
    min_outstanding: row.minOutstanding.toFixed(2), max_per_customer_per_day: row.maxPerCustomerPerDay,
    daily_company_limit: row.dailyCompanyLimit, locale: row.locale, updated_at: row.updatedAt,
  };
}

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.reminder_policy.manage.company');
    const row = await runInTenantContext(auth.ctx, () => db.reminderPolicy.findUnique({ where: { companyId: auth.companyId } }));
    return NextResponse.json(present(row));
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function PUT(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.reminder_policy.manage.company');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = PolicySchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'PUT', path: '/api/v1/communications/reminder-policy', body });
    const stageOffsets = parseStageOffsets(body.stage_offsets);
    const data = {
      enabled: body.enabled, stageOffsets: JSON.stringify(stageOffsets),
      sendWindowStartMinute: body.send_window_start_minute, sendWindowEndMinute: body.send_window_end_minute,
      minOutstanding: body.min_outstanding, maxPerCustomerPerDay: body.max_per_customer_per_day,
      dailyCompanyLimit: body.daily_company_limit, locale: body.locale, updatedBy: auth.userId,
    };
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'reminder_policy.update', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
      const before = await tx.reminderPolicy.findUnique({ where: { companyId: auth.companyId } });
      const saved = await tx.reminderPolicy.upsert({ where: { companyId: auth.companyId }, create: { companyId: auth.companyId, ...data }, update: data });
      await tx.auditLog.create({ data: { companyId: auth.companyId, userId: auth.userId, correlationId,
        action: 'reminder_policy.update', entityType: 'reminder_policy', entityId: saved.id,
        beforeValue: before ? JSON.stringify(present(before)) : null, afterValue: JSON.stringify(present(saved)) } });
      return { status: 200, body: present(saved), resourceType: 'reminder_policy', resourceId: saved.id };
      },
      tx,
    )));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid reminder policy', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
