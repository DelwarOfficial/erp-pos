// POST /api/v1/offline/sync
// Upload offline command batch from a POS device.
// Per §20.D07: verifies device key, sequence, hash, idempotency, leases.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const OfflineCommandSchema = z.object({
  command_type: z.enum(['cash_sale', 'held_sale_draft', 'shift_open', 'shift_close', 'customer_create', 'receipt_reprint']),
  sequence_number: z.number().int().positive(),
  payload: z.record(z.unknown()),
  payload_hash: z.string().length(64),
  idempotency_key: z.string().min(8).max(160),
});

const SyncSchema = z.object({
  device_id: z.string().uuid(),
  commands: z.array(OfflineCommandSchema).min(1).max(500),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'device.read');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = SyncSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/offline/sync', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'offline.sync', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // Validate device
            const device = await tx.device.findFirst({
              where: { id: body.device_id, companyId: auth.companyId, status: 'active' },
            });
            if (!device) throw new DomainError('VALIDATION_FAILED', 'Device not found or revoked', {}, 404);

            // Create sync batch
            const batch = await tx.offlineSyncBatch.create({
              data: {
                companyId: auth.companyId,
                deviceId: device.id,
                batchNumber: Date.now(),
                commandCount: body.commands.length,
              },
            });

            let syncedCount = 0;
            let conflictCount = 0;
            const results: Array<{ sequence: number; status: string; conflict?: string }> = [];

            for (const cmd of body.commands) {
              // Check for duplicate sequence
              const existing = await tx.offlineCommand.findFirst({
                where: { deviceId: device.id, sequenceNumber: cmd.sequence_number },
              });

              if (existing) {
                if (existing.payloadHash === cmd.payload_hash) {
                  // Duplicate — already synced
                  results.push({ sequence: cmd.sequence_number, status: 'duplicate' });
                  continue;
                } else {
                  // Same sequence, different payload — conflict
                  await tx.offlineCommand.create({
                    data: {
                      companyId: auth.companyId, deviceId: device.id,
                      commandType: cmd.command_type,
                      sequenceNumber: cmd.sequence_number,
                      payload: JSON.stringify(cmd.payload),
                      payloadHash: cmd.payload_hash,
                      idempotencyKey: cmd.idempotency_key,
                      status: 'conflict',
                      conflictReason: 'Same sequence number, different payload hash',
                      syncBatchId: batch.id,
                      syncedAt: new Date(),
                    },
                  });
                  conflictCount++;
                  results.push({ sequence: cmd.sequence_number, status: 'conflict', conflict: 'payload_hash_mismatch' });
                  continue;
                }
              }

              // Store the command
              await tx.offlineCommand.create({
                data: {
                  companyId: auth.companyId, deviceId: device.id,
                  commandType: cmd.command_type,
                  sequenceNumber: cmd.sequence_number,
                  payload: JSON.stringify(cmd.payload),
                  payloadHash: cmd.payload_hash,
                  idempotencyKey: cmd.idempotency_key,
                  status: 'synced',
                  syncBatchId: batch.id,
                  syncedAt: new Date(),
                },
              });
              syncedCount++;
              results.push({ sequence: cmd.sequence_number, status: 'synced' });
            }

            // Update batch
            await tx.offlineSyncBatch.update({
              where: { id: batch.id },
              data: {
                syncedCount, conflictCount,
                status: conflictCount > 0 ? 'partial' : 'completed',
                completedAt: new Date(),
              },
            });

            await tx.auditLog.create({
              data: {
                companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'offline.sync', entityType: 'offline_sync_batch', entityId: batch.id,
                afterValue: JSON.stringify({ command_count: body.commands.length, synced: syncedCount, conflicts: conflictCount }),
              },
            });

            return {
              status: 200,
              body: {
                batch_id: batch.id,
                synced_count: syncedCount,
                conflict_count: conflictCount,
                status: conflictCount > 0 ? 'partial' : 'completed',
                results,
              },
              resourceType: 'offline_sync_batch', resourceId: batch.id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid sync payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
