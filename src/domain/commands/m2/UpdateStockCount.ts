import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';
import { postStockCount } from './PostStockCount';

/** Rows per bulk statement. */
const COUNT_WRITE_BATCH = 500;

type CountWithItems = Prisma.StockCountGetPayload<{ include: { items: { include: { product: true; reasonCode: true } } } }>;
type CountedLine = { id: string; quantity: number; reasonCodeId?: string; note?: string; serialNumbers?: string[] };

/**
 * Record counted quantities (F-71). A count can have thousands of lines, all
 * saved in one SERIALIZABLE transaction, so nothing here is per line: reasons
 * and scanned serials are read in one query each, serial resolutions and line
 * values are written in bulk statements of COUNT_WRITE_BATCH rows.
 */
async function saveCountedLines(tx: Prisma.TransactionClient, companyId: string, count: CountWithItems, items: CountedLine[]) {
  if (!items.length || new Set(items.map(item => item.id)).size !== items.length) throw new DomainError('VALIDATION_FAILED', 'Provide unique counted lines', {}, 400);
  const lines = new Map(count.items.map(line => [line.id, line]));
  for (const item of items) {
    if (!lines.has(item.id) || !Number.isFinite(item.quantity) || item.quantity < 0) throw new DomainError('VALIDATION_FAILED', 'Invalid count line or quantity', {}, 400);
  }

  const reasonIds = [...new Set(items.flatMap(item => (item.reasonCodeId ? [item.reasonCodeId] : [])))];
  if (reasonIds.length) {
    const active = await tx.inventoryReasonCode.count({ where: { id: { in: reasonIds }, companyId, isActive: true } });
    if (active !== reasonIds.length) throw new DomainError('VALIDATION_FAILED', 'Select an active inventory reason', {}, 400);
  }

  // Serialized lines: every scanned number must be in this warehouse's custody.
  const scannedByLine = new Map<string, string[]>();
  for (const item of items) {
    const line = lines.get(item.id)!;
    if (!line.product.isSerialized) {
      if (item.serialNumbers?.length) throw new DomainError('VALIDATION_FAILED', 'This product does not use serials', {}, 400);
      continue;
    }
    const scanned = (item.serialNumbers ?? []).map(serial => serial.trim());
    if (new Set(scanned).size !== scanned.length || scanned.some(serial => !serial) || scanned.length !== item.quantity) throw new DomainError('VALIDATION_FAILED', 'Counted quantity must match unique scanned serials', {}, 400);
    scannedByLine.set(line.id, scanned);
  }
  if (scannedByLine.size) {
    const serializedLines = [...scannedByLine.keys()].map(id => lines.get(id)!);
    const allScanned = [...scannedByLine.values()].flat();
    const found = await tx.productSerial.findMany({ where: { companyId, productId: { in: serializedLines.map(line => line.productId) }, currentWarehouseId: count.warehouseId,
      status: { in: ['in_stock', 'reserved'] }, serialNumber: { in: allScanned } }, select: { id: true, productId: true, serialNumber: true } });
    const byKey = new Map(found.map(serial => [`${serial.productId}|${serial.serialNumber}`, serial]));
    for (const line of serializedLines) {
      if (scannedByLine.get(line.id)!.some(number => !byKey.has(`${line.productId}|${number}`))) {
        throw new DomainError('SERIAL_NOT_AVAILABLE', 'An unknown or unavailable serial was scanned. Correct its warehouse custody before including it in this count.', {}, 409);
      }
    }
    const lineIds = serializedLines.map(line => line.id);
    await tx.stockCountSerial.updateMany({ where: { stockCountItemId: { in: lineIds } }, data: { countedPresent: false, resolution: 'missing' } });
    const existing = await tx.stockCountSerial.findMany({ where: { stockCountItemId: { in: lineIds }, scannedSerialNumber: { in: allScanned } }, select: { id: true, stockCountItemId: true, scannedSerialNumber: true } });
    const seen = new Set(existing.map(row => `${row.stockCountItemId}|${row.scannedSerialNumber}`));
    const matched = existing.filter(row => scannedByLine.get(row.stockCountItemId)?.includes(row.scannedSerialNumber)).map(row => row.id);
    for (let offset = 0; offset < matched.length; offset += COUNT_WRITE_BATCH) {
      await tx.stockCountSerial.updateMany({ where: { id: { in: matched.slice(offset, offset + COUNT_WRITE_BATCH) } }, data: { countedPresent: true, resolution: 'matched' } });
    }
    const unexpected = serializedLines.flatMap(line => scannedByLine.get(line.id)!
      .filter(number => !seen.has(`${line.id}|${number}`))
      .map(number => ({ companyId, stockCountItemId: line.id, serialId: byKey.get(`${line.productId}|${number}`)!.id, scannedSerialNumber: number,
        countedPresent: true, expectedPresent: false, resolution: 'found' })));
    for (let offset = 0; offset < unexpected.length; offset += COUNT_WRITE_BATCH) {
      await tx.stockCountSerial.createMany({ data: unexpected.slice(offset, offset + COUNT_WRITE_BATCH) });
    }
  }

  // Line values, in bulk.
  for (let offset = 0; offset < items.length; offset += COUNT_WRITE_BATCH) {
    const batch = items.slice(offset, offset + COUNT_WRITE_BATCH);
    const set = (column: string, value: (item: CountedLine) => string | null) => Prisma.sql`${Prisma.raw(column)} = CASE id ${Prisma.join(
      batch.map(item => Prisma.sql`WHEN ${item.id} THEN ${value(item)}`), ' ')} END`;
    const updated = await tx.$executeRaw`
      UPDATE stock_count_items SET
        ${set('counted_quantity', item => new Prisma.Decimal(item.quantity).toString())},
        ${set('variance_quantity', item => new Prisma.Decimal(item.quantity).minus(lines.get(item.id)!.expectedQuantity).toString())},
        ${set('reason_code_id', item => item.reasonCodeId ?? null)},
        ${set('count_note', item => item.note?.trim() || null)}
      WHERE company_id = ${companyId} AND stock_count_id = ${count.id} AND id IN (${Prisma.join(batch.map(item => item.id))})`;
    if (updated !== batch.length) throw new DomainError('CONCURRENT_MODIFICATION', 'The count changed while saving; reload and retry', {}, 409);
  }
}

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
    await saveCountedLines(tx, input.companyId, count, input.items ?? []);
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
