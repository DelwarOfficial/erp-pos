// GET    /api/v1/customers/{id}  — single customer with group, preferred branch
// PUT    /api/v1/customers/{id}  — update customer master data
// DELETE /api/v1/customers/{id}  — soft-delete (set deletedAt)
//
// DELETE is rejected if the customer has an outstanding AR balance or open
// sales — those must be settled first so the customer record remains
// auditable. Soft-deleted customers are excluded from default list views
// (which filter `deletedAt: null`) but historical documents retain their
// snapshot columns.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import {
  withIdempotency,
  computeRequestHash,
  requireIdempotencyKey,
} from '@/lib/idempotency';
import { audit } from '@/lib/audit';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

// Partial-update schema — every field is optional.
const CustomerUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().max(150).nullable().optional(),
  address: z.string().max(2000).nullable().optional(),
  tax_identifier: z.string().max(50).nullable().optional(),
  credit_limit: z.number().min(0).optional(),
  customer_group_id: z.string().uuid().nullable().optional(),
  preferred_branch_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});

// Sales statuses that block customer soft-delete. A customer linked to one
// of these open sales must not be archived — the operator should complete
// or void the sale first. (Returned sales are historical and don't block.)
const OPEN_SALE_STATUSES = new Set(['draft', 'held', 'completed']);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    // `customer.read` is not in the catalogue; fall back to `product.read`
    // (the same permission used by the sibling list endpoint) for parity.
    await requirePermission(auth, 'product.read');
    const { id } = await params;

    // findFirst (not findUnique) so RLS-equivalent filter applies. We do
    // NOT exclude soft-deleted rows — historical sale views may link to a
    // since-archived customer and need to render its name.
    const customer = await db.customer.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        customerGroup: {
          select: {
            id: true,
            name: true,
            defaultDiscountRate: true,
            creditLimitDefault: true,
            isActive: true,
          },
        },
        preferredBranch: { select: { id: true, name: true, code: true } },
      },
    });

    if (!customer) {
      throw new DomainError(
        'RESOURCE_NOT_FOUND',
        'Customer not found',
        { customer_id: id },
        404,
      );
    }

    return NextResponse.json({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      tax_identifier: customer.taxIdentifier,
      credit_limit: customer.creditLimit.toString(),
      is_active: customer.isActive,
      created_at: customer.createdAt,
      updated_at: customer.updatedAt,
      deleted_at: customer.deletedAt,
      customer_group: customer.customerGroup,
      preferred_branch: customer.preferredBranch,
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    // `customer.manage` is not in the catalogue; the closest mutation
    // permission used by the sibling list endpoint is `user.create`.
    // global_admin / owner / branch_manager roles already cover the
    // `user.*` glob.
    await requirePermission(auth, 'user.create');
    const { id } = await params;

    const idempotencyKey = requireIdempotencyKey(req);
    const body = CustomerUpdateSchema.parse(await req.json());
    const requestHash = computeRequestHash({
      method: 'PUT',
      path: `/api/v1/customers/${id}`,
      body,
    });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        {
          idempotencyKey,
          operation: 'customer.update',
          requestHash,
          companyId: auth.companyId,
          userId: auth.userId,
        },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // 1. Fetch — RLS-scoped. Reject soft-deleted customers from edits.
            const existing = await tx.customer.findFirst({
              where: { id, companyId: auth.companyId, deletedAt: null },
            });
            if (!existing) {
              throw new DomainError(
                'RESOURCE_NOT_FOUND',
                'Customer not found',
                { customer_id: id },
                404,
              );
            }

            // 2. If customer_group_id is being changed, validate it.
            if (
              body.customer_group_id !== undefined &&
              body.customer_group_id !== null
            ) {
              const group = await tx.customerGroup.findFirst({
                where: {
                  id: body.customer_group_id,
                  companyId: auth.companyId,
                  isActive: true,
                },
              });
              if (!group) {
                throw new DomainError(
                  'VALIDATION_FAILED',
                  'Customer group not found or inactive',
                  { customer_group_id: body.customer_group_id },
                  400,
                );
              }
            }

            // 3. If preferred_branch_id is being changed, validate it.
            if (
              body.preferred_branch_id !== undefined &&
              body.preferred_branch_id !== null
            ) {
              const branch = await tx.branch.findFirst({
                where: {
                  id: body.preferred_branch_id,
                  companyId: auth.companyId,
                },
              });
              if (!branch) {
                throw new DomainError(
                  'VALIDATION_FAILED',
                  'Preferred branch not found',
                  { branch_id: body.preferred_branch_id },
                  400,
                );
              }
            }

            // 4. Build the update payload — only fields that were supplied.
            const updateData: Record<string, unknown> = {};
            if (body.name !== undefined) updateData.name = body.name;
            if (body.phone !== undefined) updateData.phone = body.phone;
            if (body.email !== undefined) updateData.email = body.email;
            if (body.address !== undefined) updateData.address = body.address;
            if (body.tax_identifier !== undefined)
              updateData.taxIdentifier = body.tax_identifier;
            if (body.credit_limit !== undefined)
              updateData.creditLimit = body.credit_limit;
            if (body.customer_group_id !== undefined)
              updateData.customerGroupId = body.customer_group_id;
            if (body.preferred_branch_id !== undefined)
              updateData.preferredBranchId = body.preferred_branch_id;
            if (body.is_active !== undefined)
              updateData.isActive = body.is_active;

            // 5. Apply.
            const updated = await tx.customer.update({
              where: { id: existing.id },
              data: updateData,
            });

            // 6. Audit.
            await audit({
              action: 'customer.update',
              entityType: 'customer',
              entityId: updated.id,
              beforeValue: {
                name: existing.name,
                phone: existing.phone,
                email: existing.email,
                address: existing.address,
                tax_identifier: existing.taxIdentifier,
                credit_limit: existing.creditLimit.toString(),
                customer_group_id: existing.customerGroupId,
                preferred_branch_id: existing.preferredBranchId,
                is_active: existing.isActive,
              },
              afterValue: {
                name: updated.name,
                phone: updated.phone,
                email: updated.email,
                address: updated.address,
                tax_identifier: updated.taxIdentifier,
                credit_limit: updated.creditLimit.toString(),
                customer_group_id: updated.customerGroupId,
                preferred_branch_id: updated.preferredBranchId,
                is_active: updated.isActive,
              },
            });

            return {
              status: 200,
              body: {
                id: updated.id,
                name: updated.name,
                phone: updated.phone,
                email: updated.email,
                address: updated.address,
                tax_identifier: updated.taxIdentifier,
                credit_limit: updated.creditLimit.toString(),
                customer_group_id: updated.customerGroupId,
                preferred_branch_id: updated.preferredBranchId,
                is_active: updated.isActive,
                updated_at: updated.updatedAt,
              },
              resourceType: 'customer',
              resourceId: updated.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(
        new DomainError(
          'VALIDATION_FAILED',
          'Invalid customer update payload',
          { issues: e.issues },
          400,
        ),
        correlationId,
      );
    }
    return errorResponse(e, correlationId);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    // `customer.manage` is not in the catalogue; fall back to `user.create`
    // (the closest mutation permission, used by the sibling POST endpoint).
    await requirePermission(auth, 'user.create');
    const { id } = await params;

    const idempotencyKey = requireIdempotencyKey(req);
    const requestHash = computeRequestHash({
      method: 'DELETE',
      path: `/api/v1/customers/${id}`,
      body: null,
    });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        {
          idempotencyKey,
          operation: 'customer.archive',
          requestHash,
          companyId: auth.companyId,
          userId: auth.userId,
        },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // 1. Fetch — RLS-scoped. Already-deleted customers return 404.
            const existing = await tx.customer.findFirst({
              where: { id, companyId: auth.companyId, deletedAt: null },
            });
            if (!existing) {
              throw new DomainError(
                'RESOURCE_NOT_FOUND',
                'Customer not found or already archived',
                { customer_id: id },
                404,
              );
            }

            // 2. AR-balance guard — any customer-linked journal line on the
            //    AR control account that nets to a non-zero balance blocks
            //    the archive. We approximate AR exposure as: any posted
            //    sale in 'completed' status with an unpaid grand_total.
            //    The customer's outstanding balance is computed from
            //    posted sales minus allocated payments.
            const openSales = await tx.sale.findFirst({
              where: {
                customerId: existing.id,
                companyId: auth.companyId,
                saleStatus: 'completed',
              },
              select: { id: true, grandTotal: true },
            });
            if (openSales) {
              // Sum allocations against this customer's sales.
              const allocations = await tx.paymentAllocation.aggregate({
                _sum: { allocatedAmount: true },
                where: {
                  companyId: auth.companyId,
                  sale: { customerId: existing.id, saleStatus: 'completed' },
                },
              });
              const allocated =
                allocations._sum.allocatedAmount?.toString() ?? '0';
              const total = openSales.grandTotal.toString();
              // If allocations don't fully cover the open sale total, the
              // customer has an outstanding AR balance — block the archive.
              if (parseFloat(allocated) < parseFloat(total) - 0.01) {
                throw new DomainError(
                  'VALIDATION_FAILED',
                  'Cannot archive a customer with an outstanding AR balance — settle open sales first',
                  {
                    customer_id: existing.id,
                    open_sale_id: openSales.id,
                    grand_total: total,
                    allocated: allocated,
                    outstanding: (parseFloat(total) - parseFloat(allocated)).toFixed(2),
                  },
                  409,
                );
              }
            }

            // 3. Open-draft-sales guard — any draft/held sale referencing
            //    this customer blocks the archive (the operator should
            //    complete or void those sales first).
            const openDraftSale = await tx.sale.findFirst({
              where: {
                customerId: existing.id,
                companyId: auth.companyId,
                saleStatus: { in: ['draft', 'held'] },
              },
              select: { id: true, saleStatus: true },
            });
            if (openDraftSale) {
              throw new DomainError(
                'VALIDATION_FAILED',
                'Cannot archive a customer with open draft/held sales — complete or void those sales first',
                {
                  customer_id: existing.id,
                  sale_id: openDraftSale.id,
                  sale_status: openDraftSale.saleStatus,
                },
                409,
              );
            }

            // 4. Soft-delete — set deletedAt only. We do NOT flip isActive
            //    because some historical queries filter on isActive for
            //    drop-downs; the deletedAt predicate is the canonical
            //    archive signal used by the list endpoint.
            const archived = await tx.customer.update({
              where: { id: existing.id },
              data: { deletedAt: new Date() },
            });

            // 5. Audit.
            await audit({
              action: 'customer.archive',
              entityType: 'customer',
              entityId: archived.id,
              beforeValue: {
                name: existing.name,
                phone: existing.phone,
                email: existing.email,
                is_active: existing.isActive,
                deleted_at: existing.deletedAt,
              },
              afterValue: {
                name: archived.name,
                phone: archived.phone,
                email: archived.email,
                is_active: archived.isActive,
                deleted_at: archived.deletedAt,
              },
            });

            return {
              status: 200,
              body: {
                id: archived.id,
                name: archived.name,
                is_active: archived.isActive,
                deleted_at: archived.deletedAt,
                archived: true,
              },
              resourceType: 'customer',
              resourceId: archived.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
