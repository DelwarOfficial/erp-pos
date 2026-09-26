// Uploads one batch of commands captured by a POS terminal while offline.
// Extracted from POST /api/v1/offline/sync so the unit of work can be exercised
// and timed against a real database in the route's own transaction.

import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { applyOfflineCommand } from './applyOfflineCommand';
import { DomainError } from '@/lib/errors/codes';

export interface OfflineSyncCommand {
  command_type: string;
  sequence_number: number;
  payload: Record<string, unknown>;
  payload_hash: string;
  idempotency_key: string;
}

export async function syncOfflineBatch(
  tx: Prisma.TransactionClient,
  input: { companyId: string; userId: string; deviceId: string; commands: OfflineSyncCommand[] },
  correlationId: string,
) {
  // Validate device
  const device = await tx.device.findFirst({
    where: { id: input.deviceId, companyId: input.companyId, status: 'active' },
  });
  if (!device) throw new DomainError('VALIDATION_FAILED', 'Device not found or revoked', {}, 404);

  // Create sync batch, numbered per device. This was Date.now() -- about
  // 1.8 × 10^12 -- into an INT column, which MariaDB rejects: every offline
  // sync failed before applying a single command.
  const previous = await tx.offlineSyncBatch.aggregate({ where: { companyId: input.companyId, deviceId: device.id }, _max: { batchNumber: true } });
  const batch = await tx.offlineSyncBatch.create({
    data: {
      companyId: input.companyId,
      deviceId: device.id,
      batchNumber: (previous._max.batchNumber ?? 0) + 1,
      commandCount: input.commands.length,
    },
  });

  let syncedCount = 0;
  let conflictCount = 0;
  let appliedCount = 0;
  const results: Array<{ sequence: number; status: string; conflict?: string; resource_id?: string }> = [];

  // The hash is recomputed here: deduplication and conflict detection key on
  // it, so accepting the client's value let a tampered or buggy terminal have
  // a different payload classified as an already-seen duplicate and silently
  // discarded. Every command is checked before any is applied.
  const hashes = input.commands.map(cmd => {
    const computedHash = createHash('sha256').update(JSON.stringify(cmd.payload)).digest('hex');
    if (computedHash !== cmd.payload_hash) {
      throw new DomainError('VALIDATION_FAILED',
        `Payload hash mismatch for sequence ${cmd.sequence_number}`,
        { sequence_number: cmd.sequence_number }, 400);
    }
    return computedHash;
  });

  // Sequence numbers this device has already synced, in one query rather than
  // one per command; commands applied below are added as they go, so a
  // sequence repeated within this batch is caught too.
  const seen = new Map<number, string>();
  const known = await tx.offlineCommand.findMany({
    where: { deviceId: device.id, sequenceNumber: { in: [...new Set(input.commands.map(cmd => cmd.sequence_number))] } },
    select: { sequenceNumber: true, payloadHash: true },
  });
  for (const row of known) seen.set(row.sequenceNumber, row.payloadHash);
  const conflicts: Array<{ sequence: number; payload_hash: string; recorded_hash: string }> = [];

  for (const [index, cmd] of input.commands.entries()) {
    const computedHash = hashes[index];
    const recorded = seen.get(cmd.sequence_number);
    if (recorded !== undefined) {
      if (recorded === computedHash) {
        // Duplicate — already synced
        results.push({ sequence: cmd.sequence_number, status: 'duplicate' });
      } else {
        // Same sequence, different payload — conflict. The recorded command
        // stands. This used to insert a second offline_commands row for the
        // same (device, sequence), which the unique key rejects: the whole
        // batch failed instead of reporting the conflict. The conflicting
        // payload is kept in this batch's audit entry.
        conflictCount++;
        conflicts.push({ sequence: cmd.sequence_number, payload_hash: computedHash, recorded_hash: recorded });
        results.push({ sequence: cmd.sequence_number, status: 'conflict', conflict: 'payload_hash_mismatch' });
      }
      continue;
    }

    // Apply the command through the same domain command the online
    // path uses, inside this transaction. A failure aborts the whole
    // batch rather than recording a command that was never applied.
    const outcome = await applyOfflineCommand(tx, {
      companyId: input.companyId,
      userId: input.userId,
      commandType: cmd.command_type,
      payload: cmd.payload,
    }, correlationId);

    await tx.offlineCommand.create({
      data: {
        companyId: input.companyId, deviceId: device.id,
        commandType: cmd.command_type,
        sequenceNumber: cmd.sequence_number,
        payload: JSON.stringify(cmd.payload),
        payloadHash: computedHash,
        idempotencyKey: cmd.idempotency_key,
        status: outcome.status === 'applied' ? 'applied' : 'synced',
        conflictReason: outcome.status === 'stored' ? outcome.reason : null,
        syncBatchId: batch.id,
        syncedAt: new Date(),
      },
    });
    seen.set(cmd.sequence_number, computedHash);
    syncedCount++;
    if (outcome.status === 'applied') appliedCount++;
    results.push(outcome.status === 'applied'
      ? { sequence: cmd.sequence_number, status: 'applied', resource_id: outcome.resourceId }
      : { sequence: cmd.sequence_number, status: 'stored' });
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
      companyId: input.companyId, userId: input.userId, correlationId,
      action: 'offline.sync', entityType: 'offline_sync_batch', entityId: batch.id,
      afterValue: JSON.stringify({ command_count: input.commands.length, synced: syncedCount, conflicts: conflictCount,
        ...(conflicts.length > 0 ? { conflicting_commands: conflicts } : {}) }),
    },
  });

  return {
    status: 200,
    body: {
      batch_id: batch.id,
      synced_count: syncedCount,
      applied_count: appliedCount,
      conflict_count: conflictCount,
      status: conflictCount > 0 ? 'partial' : 'completed',
      results,
    },
    resourceType: 'offline_sync_batch', resourceId: batch.id,
  };
}
