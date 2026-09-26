// POST /api/v1/offline/sync
// Upload offline command batch from a POS device.
// Per §20.D07: verifies device key, sequence, hash, idempotency, leases.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { syncOfflineBatch } from '@/domain/offline/syncOfflineBatch';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const OfflineCommandSchema = z.object({
  command_type: z.enum(['cash_sale', 'held_sale_draft', 'shift_open', 'shift_close', 'customer_create', 'receipt_reprint']),
  sequence_number: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
  payload_hash: z.string().length(64),
  idempotency_key: z.string().min(8).max(160),
});

export const OFFLINE_SYNC_MAX_COMMANDS = 200;

const SyncSchema = z.object({
  device_id: z.string().uuid(),
  // A batch is applied in one Serializable transaction with a 30-second
  // timeout. 500 real cash sales took over 30 s on an idle local MariaDB and
  // rolled back entirely; 200 take well under half of it. A terminal with more
  // sends several batches -- duplicate detection makes a resend safe.
  commands: z.array(OfflineCommandSchema).min(1).max(OFFLINE_SYNC_MAX_COMMANDS),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'sale.post');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = SyncSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/offline/sync', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async (tx) =>
        withIdempotency(
          { idempotencyKey, operation: 'offline.sync', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => syncOfflineBatch(tx, {
            companyId: auth.companyId, userId: auth.userId!, deviceId: body.device_id, commands: body.commands,
          }, correlationId),
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid sync payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
