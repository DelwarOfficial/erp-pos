import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';
import { postStockCount } from './PostStockCount';

export async function updateStockCount(tx: Prisma.TransactionClient, input: {
  companyId: string; id: string; userId: string; action: 'start' | 'save' | 'review' | 'reopen' | 'cancel' | 'post';
  items?: { id: string; quantity: number; reasonCodeId?: string; note?: string; serialNumbers?: string[] }[];
}, correlationId: string) {
  const count = await tx.stockCount.findFirst({ where: { id: input.id, companyId: input.companyId }, include: { items: { include: { product: true, reasonCode: true } } } });
  if (!count) throw new DomainError('RESOURCE_NOT_FOUND', 'Stock count not found', {}, 404);
  if (input.action === 'post') return postStockCount(tx, { companyId: input.companyId, stockCountId: count.id, postedBy: input.userId }, correlationId);
  const allowed: Record<string, string[]> = { start: ['draft'], save: ['counting'], review: ['counting'], reopen: ['reviewed'], cancel: ['draft', 'counting', 'reviewed'] };
  if (!allowed[input.action]?.includes(count.status)) throw new DomainError('VALIDATION_FAILED', `Cannot ${input.action} a ${count.status} count`, {}, 409);
  let status = count.status;
  if (input.action === 'save') {
    if (!input.items?.length || new Set(input.items.map(item => item.id)).size !== input.items.length) throw new DomainError('VALIDATION_FAILED', 'Provide unique counted lines', {}, 400);
    for (const item of input.items) {
      const line = count.items.find(line => line.id === item.id);
      if (!line || !Number.isFinite(item.quantity) || item.quantity < 0) throw new DomainError('VALIDATION_FAILED', 'Invalid count line or quantity', {}, 400);
      if (item.reasonCodeId && !await tx.inventoryReasonCode.findFirst({ where: { id: item.reasonCodeId, companyId: input.companyId, isActive: true } })) throw new DomainError('VALIDATION_FAILED', 'Select an active inventory reason', {}, 400);
      if (line.product.isSerialized) {
        const scanned = (item.serialNumbers ?? []).map(serial => serial.trim());
        if (new Set(scanned).size !== scanned.length || scanned.some(serial => !serial) || scanned.length !== item.quantity) throw new DomainError('VALIDATION_FAILED', 'Counted quantity must match unique scanned serials', {}, 400);
        const serials = await tx.productSerial.findMany({ where: { companyId: input.companyId, productId: line.productId, currentWarehouseId: count.warehouseId, status: { in: ['in_stock', 'reserved'] }, serialNumber: { in: scanned } } });
        if (serials.length !== scanned.length) throw new DomainError('SERIAL_NOT_AVAILABLE', 'An unknown or unavailable serial was scanned. Correct its warehouse custody before including it in this count.', {}, 409);
        await tx.stockCountSerial.updateMany({ where: { stockCountItemId: line.id }, data: { countedPresent: false, resolution: 'missing' } });
        for (const serial of serials) await tx.stockCountSerial.upsert({ where: { stockCountItemId_scannedSerialNumber: { stockCountItemId: line.id, scannedSerialNumber: serial.serialNumber } },
          create: { companyId: input.companyId, stockCountItemId: line.id, serialId: serial.id, scannedSerialNumber: serial.serialNumber, countedPresent: true, expectedPresent: false, resolution: 'found' },
          update: { countedPresent: true, resolution: 'matched' } });
      } else if (item.serialNumbers?.length) throw new DomainError('VALIDATION_FAILED', 'This product does not use serials', {}, 400);
      await tx.stockCountItem.update({ where: { id: line.id }, data: { countedQuantity: item.quantity, varianceQuantity: new Prisma.Decimal(item.quantity).minus(line.expectedQuantity), reasonCodeId: item.reasonCodeId ?? null, countNote: item.note?.trim() || null } });
    }
  } else if (input.action === 'review') {
    if (!count.items.length || count.items.some(line => line.countedQuantity === null)) throw new DomainError('VALIDATION_FAILED', 'Save a count for every line before review', {}, 400);
    if (count.items.some(line => !line.varianceQuantity?.isZero() && !line.countNote?.trim())) throw new DomainError('VALIDATION_FAILED', 'Explain each variance in its count note before review', {}, 400);
    status = 'reviewed';
    if (count.items.some(line => !line.varianceQuantity?.isZero() && line.reasonCode?.requiresApproval)) {
      await tx.approvalRequest.create({ data: { companyId: input.companyId, branchId: count.branchId, requestType: 'stock_count', referenceType: 'stock_count', referenceId: count.id,
        requestedBy: input.userId, status: 'pending', reason: `Review variances for ${count.referenceNo}`, payload: JSON.stringify({ stock_count_id: count.id }) } });
    }
  } else if (input.action === 'start' || input.action === 'reopen') status = 'counting';
  else status = 'cancelled';
  if (input.action === 'reopen' || input.action === 'cancel') await tx.approvalRequest.updateMany({ where: { companyId: input.companyId, referenceType: 'stock_count', referenceId: count.id, status: { in: ['pending', 'approved'] } }, data: { status: 'cancelled' } });
  await tx.stockCount.update({ where: { id: count.id }, data: { status, ...(input.action === 'review' ? { reviewedBy: input.userId } : input.action === 'reopen' ? { reviewedBy: null } : {}) } });
  await tx.auditLog.create({ data: { companyId: input.companyId, userId: input.userId, correlationId, action: `stock_count.${input.action}`, entityType: 'stock_count', entityId: count.id,
    beforeValue: JSON.stringify({ status: count.status }), afterValue: JSON.stringify({ status, items: input.items }) } });
  return { id: count.id, status };
}
