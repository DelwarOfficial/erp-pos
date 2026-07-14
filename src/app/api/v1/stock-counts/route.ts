// GET  /api/v1/stock-counts       — list stock counts
// POST /api/v1/stock-counts       — create a stock count (draft) and optionally post it

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postStockCount } from '@/domain/commands/m2/PostStockCount';
import { nextDocumentNumber } from '@/lib/numbering';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { randomUUID } from 'node:crypto';

const CountItemSchema = z.object({
  product_id: z.string().uuid(),
  batch_id: z.string().uuid().optional(),
  expected_quantity: z.number().min(0).default(0),
  counted_quantity: z.number().min(0).optional(),
  reason_code_id: z.string().uuid().optional(),
  count_note: z.string().max(500).optional(),
});

const CreateStockCountSchema = z.object({
  branch_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  scope_type: z.enum(['all', 'category', 'brand']).default('all'),
  category_id: z.string().uuid().optional(),
  brand_id: z.string().uuid().optional(),
  blind_count: z.boolean().default(true),
  movement_freeze_policy: z.enum(['warn', 'block', 'allow']).default('warn'),
  notes: z.string().max(2000).optional(),
  items: z.array(CountItemSchema).default([]),
  post: z.boolean().default(false), // if true, post immediately (counts must already exist)
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'inventory.read');
    const url = req.nextUrl;
    const status = url.searchParams.get('status') ?? undefined;
    const warehouseId = url.searchParams.get('warehouse_id') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.status = status;
    if (warehouseId) where.warehouseId = warehouseId;

    const [items, total] = await Promise.all([
      db.stockCount.findMany({
        where, take: limit, skip: offset, orderBy: { createdAt: 'desc' },
        include: {
          warehouse: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      db.stockCount.count({ where }),
    ]);

    return NextResponse.json({
      items: items.map(sc => ({
        id: sc.id, reference_no: sc.referenceNo, status: sc.status,
        branch: sc.branch, warehouse: sc.warehouse,
        scope_type: sc.scopeType, blind_count: sc.blindCount,
        movement_freeze_policy: sc.movementFreezePolicy,
        snapshot_at: sc.snapshotAt, notes: sc.notes,
        item_count: sc._count.items,
        created_by: sc.createdBy, reviewed_by: sc.reviewedBy, posted_by: sc.postedBy,
        created_at: sc.createdAt, posted_at: sc.postedAt,
      })),
      total, limit, offset,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'stock_count.post');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = CreateStockCountSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/stock-counts', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'stock_count.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
              companyId: auth.companyId, branchId: body.branch_id,
              documentType: 'STOCK_COUNT', fiscalYear: new Date().getFullYear(), prefix: 'SC-',
            });

            const sc = await tx.stockCount.create({
              data: {
                companyId: auth.companyId, branchId: body.branch_id, warehouseId: body.warehouse_id,
                referenceNo, scopeType: body.scope_type,
                categoryId: body.category_id ?? null, brandId: body.brand_id ?? null,
                status: body.post ? 'reviewed' : 'draft',
                blindCount: body.blind_count, movementFreezePolicy: body.movement_freeze_policy,
                notes: body.notes ?? null, createdBy: auth.userId,
              },
            });

            let lineNo = 1;
            for (const item of body.items) {
              await tx.stockCountItem.create({
                data: {
                  companyId: auth.companyId, stockCountId: sc.id, lineNo,
                  productId: item.product_id, batchId: item.batch_id ?? null,
                  expectedQuantity: item.expected_quantity,
                  countedQuantity: item.counted_quantity ?? null,
                  varianceQuantity: item.counted_quantity !== undefined
                    ? item.counted_quantity - item.expected_quantity : null,
                  reasonCodeId: item.reason_code_id ?? null,
                  countNote: item.count_note ?? null,
                },
              });
              lineNo++;
            }

            let posted: { status: string; adjustmentsPosted: number } | null = null;
            if (body.post && body.items.length > 0) {
              posted = await postStockCount(tx, {
                companyId: auth.companyId, stockCountId: sc.id, postedBy: auth.userId,
              }, correlationId);
            }

            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'stock_count.create', entityType: 'stock_count', entityId: sc.id,
                afterValue: JSON.stringify({ reference_no: referenceNo, posted: !!posted, items: body.items.length }) },
            });

            return {
              status: 201,
              body: {
                id: sc.id, reference_no: referenceNo,
                status: posted ? posted.status : sc.status,
                items_count: body.items.length,
                adjustments_posted: posted?.adjustmentsPosted ?? 0,
              },
              resourceType: 'stock_count', resourceId: sc.id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid stock count payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
