import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { updateStockCount } from '@/domain/commands/m2/UpdateStockCount';
import { STOCK_COUNT_TRANSACTION_TIMEOUT_MS } from '@/domain/commands/m2/CreateStockCount';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
const schema = z.object({ action: z.enum(['start', 'save', 'review', 'reopen', 'cancel', 'post']), items: z.array(z.object({ id: z.string().uuid(), quantity: z.number().nonnegative(), reason_code_id: z.string().uuid().optional(), note: z.string().max(500).optional(), serial_numbers: z.array(z.string().trim().min(1).max(255)).optional() })).optional() });
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest(); await requirePermission(auth, 'stock_count.post');
    const { id } = await params; const body = schema.parse(await req.json()); const key = requireIdempotencyKey(req);
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, tx => withIdempotency({ companyId: auth.companyId, userId: auth.userId, idempotencyKey: key, operation: `stock_count.${body.action}`, requestHash: computeRequestHash({ method: 'POST', path: `/api/v1/stock-counts/${id}/actions`, body }) }, async () => {
      const result = await updateStockCount(tx, { companyId: auth.companyId, userId: auth.userId, id, action: body.action, items: body.items?.map(item => ({ id: item.id, quantity: item.quantity, reasonCodeId: item.reason_code_id, note: item.note, serialNumbers: item.serial_numbers })) }, correlationId);
      return { status: 200, body: result, resourceType: 'stock_count', resourceId: id };
    }, tx), { timeout: STOCK_COUNT_TRANSACTION_TIMEOUT_MS }));
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { return errorResponse(error instanceof z.ZodError ? new DomainError('VALIDATION_FAILED', 'Check stock count values', { issues: error.issues }, 400) : error, correlationId); }
}
