import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

type Kind = 'categories' | 'brands' | 'units' | 'tax-components';
const category = z.object({ name: z.string().trim().min(1).max(120), code: z.string().trim().min(1).max(40) });
const brand = z.object({ name: z.string().trim().min(1).max(120) });
const unit = z.object({ name: z.string().trim().min(1).max(80), code: z.string().trim().min(1).max(20), conversion_factor: z.number().positive(), allow_fractional: z.boolean() });
const tax = z.object({ name: z.string().trim().min(1).max(100), component_code: z.string().trim().min(1).max(30), component_type: z.enum(['VAT', 'SD', 'RD', 'ATV', 'OTHER']), rate: z.number().min(0).max(100), calculation_order: z.number().int().min(1), compound_on_previous: z.boolean(), effective_from: z.string().datetime().or(z.string().date()) });

/** Existing master-data resources: safe updates and deletion only while unreferenced. */
export async function catalogueMutation(req: NextRequest, id: string, kind: Kind) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, kind === 'tax-components' ? 'tax.manage' : 'category.manage');
    const idempotencyKey = requireIdempotencyKey(req);
    const deleting = req.method === 'DELETE';
    const body = deleting ? {} : await req.json();
    const requestHash = computeRequestHash({ method: req.method, path: `/api/v1/${kind}/${id}`, body });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, tx => withIdempotency(
      { idempotencyKey, operation: `${kind}.${deleting ? 'delete' : 'update'}`, requestHash, companyId: auth.companyId, userId: auth.userId }, async () => {
        const where = { id, companyId: auth.companyId };
        const missing = () => { throw new DomainError('RESOURCE_NOT_FOUND', 'Catalogue record not found', {}, 404); };
        const inUse = () => { throw new DomainError('VALIDATION_FAILED', 'This record is in use. Historical references must be preserved.', {}, 409); };
        let before: unknown; let after: unknown = null;
        if (kind === 'categories') {
          const row = await tx.category.findFirst({ where: { ...where, deletedAt: null } }); if (!row) return missing(); before = row;
          if (deleting) {
            if (await tx.product.count({ where: { categoryId: id } }) || await tx.category.count({ where: { parentId: id } }) || await tx.stockCount.count({ where: { categoryId: id } })) return inUse();
            await tx.category.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
          } else after = await tx.category.update({ where: { id }, data: category.parse(body) });
        } else if (kind === 'brands') {
          const row = await tx.brand.findFirst({ where: { ...where, deletedAt: null } }); if (!row) return missing(); before = row;
          if (deleting) {
            if (await tx.product.count({ where: { brandId: id } }) || await tx.stockCount.count({ where: { brandId: id } })) return inUse();
            await tx.brand.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
          } else after = await tx.brand.update({ where: { id }, data: brand.parse(body) });
        } else if (kind === 'units') {
          const row = await tx.unit.findFirst({ where }); if (!row) return missing(); before = row;
          const used = await tx.product.count({ where: { unitId: id } }) || await tx.unit.count({ where: { baseUnitId: id } });
          if (deleting) { if (used) return inUse(); await tx.unit.delete({ where: { id } }); }
          else {
            const value = unit.parse(body);
            if (used && (!row.conversionFactor.equals(value.conversion_factor) || row.allowFractional !== value.allow_fractional || row.code !== value.code)) return inUse();
            if (!row.baseUnitId && value.conversion_factor !== 1) throw new DomainError('VALIDATION_FAILED', 'Base unit conversion factor must be 1', {}, 400);
            after = await tx.unit.update({ where: { id }, data: { name: value.name, code: value.code, conversionFactor: value.conversion_factor, allowFractional: value.allow_fractional } });
          }
        } else {
          const row = await tx.taxComponent.findFirst({ where }); if (!row) return missing(); before = row;
          if (await tx.saleItemTax.count({ where: { taxComponentId: id } }) || await tx.taxCodeComponent.count({ where: { taxComponentId: id } })) return inUse();
          if (deleting) await tx.taxComponent.delete({ where: { id } });
          else { const value = tax.parse(body); after = await tx.taxComponent.update({ where: { id }, data: { name: value.name, componentCode: value.component_code, componentType: value.component_type, rate: value.rate, calculationOrder: value.calculation_order, compoundOnPrevious: value.compound_on_previous, effectiveFrom: new Date(value.effective_from) } }); }
        }
        await tx.auditLog.create({ data: { companyId: auth.companyId, userId: auth.userId, correlationId, action: `${kind}.${deleting ? 'delete' : 'update'}`, entityType: kind, entityId: id, beforeValue: JSON.stringify(before), afterValue: JSON.stringify(after) } });
        return { status: 200, body: { id, deleted: deleting }, resourceType: kind, resourceId: id };
      }, tx)));
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Check catalogue fields', { issues: error.issues }, 400), correlationId);
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2003'].includes(error.code)) return errorResponse(new DomainError('VALIDATION_FAILED', 'Record is duplicated or referenced by another business record', {}, 409), correlationId);
    return errorResponse(error, correlationId);
  }
}
