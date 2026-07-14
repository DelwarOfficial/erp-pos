// src/lib/idempotency/index.ts
// Idempotency middleware per §5.3 idempotency_requests + §5 Section 12.
//
// Behavior:
//   - Every mutation requires an Idempotency-Key header (and client_txn_id).
//   - Same key + same request_hash → return the stored committed response.
//   - Same key + different hash → 409 IDEMPOTENCY_KEY_REUSED + security event.
//   - Stored response is retained until expires_at (default 24h).
//
// Implementation:
//   - On entry, INSERT the idempotency_requests row with status='processing'.
//     If a unique constraint fires (same key exists), look up the existing
//     row and either replay or 409.
//   - On success, UPDATE row with status='succeeded', response_status,
//     response_body, resource_id, completed_at.
//   - On failure, UPDATE row with status='failed', completed_at.

import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { db } from '../db';
import { DomainError } from '../errors/codes';
import { getTenantContext } from '../db/transaction';
import { recordSecurityEvent } from '../audit';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export function computeRequestHash(params: {
  method: string;
  path: string;
  body: unknown;
}): string {
  const canonical = JSON.stringify({
    method: params.method.toUpperCase(),
    path: params.path,
    body: params.body,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export interface IdempotencyResult<T> {
  response: Response | T;
  isReplay: boolean;
}

/**
 * Wrap a mutation handler with idempotency protection.
 * The handler MUST run inside a tenant context (i.e., after authenticateRequest).
 */
export async function withIdempotency<T extends Response>(
  params: {
    idempotencyKey: string;
    operation: string;
    requestHash: string;
    companyId: string;
    userId?: string;
    deviceId?: string;
  },
  work: () => Promise<{ status: number; body: unknown; resourceType?: string; resourceId?: string }>,
): Promise<{ status: number; body: unknown; isReplay: boolean }> {
  const ctx = getTenantContext();
  if (!ctx) throw new Error('withIdempotency requires tenant context');

  // 1. Try to insert a fresh idempotency_requests row.
  //    If the key already exists, we either replay or 409.
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);
  let row;
  try {
    row = await db.idempotencyRequest.create({
      data: {
        companyId: params.companyId,
        userId: params.userId ?? null,
        deviceId: params.deviceId ?? null,
        idempotencyKey: params.idempotencyKey,
        operation: params.operation,
        requestHash: params.requestHash,
        status: 'processing',
        expiresAt,
      },
    });
  } catch (e) {
    // Likely unique violation — key already exists. Re-throw any other error.
    const errStr = e instanceof Error ? e.message : String(e);
    const isUnique =
      errStr.includes('Unique constraint') ||
      errStr.includes('UNIQUE constraint failed');
    if (!isUnique) {
      throw new DomainError('INTERNAL_ERROR', `Idempotency create failed: ${errStr}`, {}, 500);
    }
    const existing = await db.idempotencyRequest.findFirst({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (!existing) {
      // Raced — re-throw original error
      throw new DomainError('CONCURRENT_MODIFICATION', 'Idempotency race — retry', {}, 409);
    }
    if (existing.companyId !== params.companyId) {
      // Cross-tenant key reuse → critical security event
      await recordSecurityEvent({
        eventType: 'idempotency_key_cross_tenant_reuse',
        severity: 'critical',
        metadata: { idempotency_key: params.idempotencyKey },
        companyId: params.companyId,
      });
      throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'Idempotency key conflict', {}, 409);
    }
    if (existing.requestHash !== params.requestHash) {
      // Same key + different hash → 409 + security event
      await recordSecurityEvent({
        eventType: 'idempotency_key_hash_mismatch',
        severity: 'high',
        metadata: {
          idempotency_key: params.idempotencyKey,
          operation: params.operation,
        },
        companyId: params.companyId,
        userId: params.userId,
      });
      throw new DomainError(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key was used with a different request body',
        { idempotency_key: params.idempotencyKey },
        409,
      );
    }

    // Same key + same hash → replay stored response
    if (existing.status === 'processing') {
      // Still in-flight from another request — ask client to retry
      throw new DomainError(
        'CONCURRENT_MODIFICATION',
        'Request with same idempotency key is in flight — retry shortly',
        { idempotency_key: params.idempotencyKey },
        409,
      );
    }
    return {
      status: existing.responseStatus ?? 200,
      body: existing.responseBody ? JSON.parse(existing.responseBody) : null,
      isReplay: true,
    };
  }

  // 2. Run the actual work.
  try {
    const result = await work();
    await db.idempotencyRequest.update({
      where: { id: row.id },
      data: {
        status: result.status < 400 ? 'succeeded' : 'failed',
        resourceType: result.resourceType ?? null,
        resourceId: result.resourceId ?? null,
        responseStatus: result.status,
        responseBody: JSON.stringify(result.body),
        completedAt: new Date(),
      },
    });
    return { status: result.status, body: result.body, isReplay: false };
  } catch (e) {
    const err = e instanceof DomainError ? e : new DomainError(
      'INTERNAL_ERROR',
      e instanceof Error ? e.message : 'Unknown error',
      {},
      500,
    );
    await db.idempotencyRequest.update({
      where: { id: row.id },
      data: {
        status: 'failed',
        responseStatus: err.httpStatus,
        responseBody: JSON.stringify(err.toJSON()),
        completedAt: new Date(),
      },
    });
    throw err;
  }
}

export function requireIdempotencyKey(req: NextRequest): string {
  const key = req.headers.get('idempotency-key');
  if (!key || key.length < 8 || key.length > 160) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'Idempotency-Key header is required (8–160 chars) for all mutations',
      {},
      400,
    );
  }
  return key;
}
