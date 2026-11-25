// src/domain/commands/m2/CreatePurchase.ts
// Creates a purchase order and its lines. A purchase moves no stock: stock
// moves when a receiving is posted (ReceivePurchase.ts).
//
// Moved out of POST /api/v1/purchases unchanged so the CSV import creates
// purchases through the same code as the API.

import { Prisma } from '@prisma/client';
import { nextDocumentNumber } from '@/lib/numbering';
import { DomainError } from '@/lib/errors/codes';

export interface CreatePurchaseInput {
  companyId: string;
  branchId: string;
  warehouseId: string;
  supplierId: string;
  supplierInvoiceNo?: string;
  currencyCode: string;
  exchangeRate: number;
  orderDate: Date;
  expectedDate?: Date;
  notes?: string;
  createdBy: string;
  /** 'ordered' from the API; the CSV import creates 'draft' orders. */
  orderStatus: 'ordered' | 'draft';
  items: Array<{
    productId: string;
    qtyOrdered: number;
    unitCost: number;
    discountAmount: number;
    taxAmount: number;
  }>;
}

export interface CreatePurchaseResult {
  id: string;
  referenceNo: string;
  orderStatus: string;
  grandTotal: number;
  baseGrandTotal: number;
  itemCount: number;
}

const PRODUCT_VALIDATION_BATCH_SIZE = 500;

export async function createPurchase(
  tx: Prisma.TransactionClient,
  input: CreatePurchaseInput,
  correlationId: string,
): Promise<CreatePurchaseResult> {
  // Validate supplier + branch + warehouse belong to this company
  const supplier = await tx.supplier.findFirst({
    where: { id: input.supplierId, companyId: input.companyId, deletedAt: null },
  });
  if (!supplier) throw new DomainError('VALIDATION_FAILED', 'Supplier not found', {}, 404);

  const branch = await tx.branch.findFirst({
    where: { id: input.branchId, companyId: input.companyId },
  });
  if (!branch) throw new DomainError('VALIDATION_FAILED', 'Branch not found', {}, 404);

  const warehouse = await tx.warehouse.findFirst({
    where: { id: input.warehouseId, companyId: input.companyId, branchId: input.branchId },
  });
  if (!warehouse) throw new DomainError('VALIDATION_FAILED', 'Warehouse not found or not in this branch', {}, 404);

  // Generate reference number
  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId,
    branchId: input.branchId,
    documentType: 'PURCHASE',
    fiscalYear: input.orderDate.getFullYear(),
    prefix: 'PO-',
  });

  // Compute totals
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  for (const item of input.items) {
    subtotal += item.qtyOrdered * item.unitCost;
    discountTotal += item.discountAmount;
    taxTotal += item.taxAmount;
  }
  const grandTotal = subtotal - discountTotal + taxTotal;
  const baseGrandTotal = grandTotal * input.exchangeRate;

  const purchase = await tx.purchase.create({
    data: {
      companyId: input.companyId,
      branchId: input.branchId,
      warehouseId: input.warehouseId,
      referenceNo,
      supplierInvoiceNo: input.supplierInvoiceNo ?? null,
      supplierId: input.supplierId,
      orderStatus: input.orderStatus,
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
      orderDate: input.orderDate,
      expectedDate: input.expectedDate ?? null,
      subtotal,
      discountTotal,
      taxTotal,
      grandTotal,
      baseGrandTotal,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
    },
  });

  // Create items
  const productIds = [...new Set(input.items.map(item => item.productId))];
  const products: Array<{ id: string; name: string; code: string }> = [];
  for (let offset = 0; offset < productIds.length; offset += PRODUCT_VALIDATION_BATCH_SIZE) {
    products.push(...await tx.product.findMany({
      where: {
        companyId: input.companyId,
        deletedAt: null,
        id: { in: productIds.slice(offset, offset + PRODUCT_VALIDATION_BATCH_SIZE) },
      },
      select: { id: true, name: true, code: true },
    }));
  }
  const productById = new Map(products.map(product => [product.id, product]));
  let lineNo = 1;
  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product) throw new DomainError('VALIDATION_FAILED', `Product ${item.productId} not found`, {}, 404);

    const lineTotal = item.qtyOrdered * item.unitCost - item.discountAmount + item.taxAmount;
    await tx.purchaseItem.create({
      data: {
        companyId: input.companyId,
        purchaseId: purchase.id,
        lineNo,
        productId: item.productId,
        productNameSnapshot: product.name,
        productCodeSnapshot: product.code,
        qtyOrdered: item.qtyOrdered,
        unitCost: item.unitCost,
        discountAmount: item.discountAmount,
        taxAmount: item.taxAmount,
        lineTotal,
      },
    });
    lineNo++;
  }

  await tx.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: input.createdBy,
      correlationId,
      action: 'purchase.create',
      entityType: 'purchase',
      entityId: purchase.id,
      afterValue: JSON.stringify({ reference_no: referenceNo, supplier: supplier.name, item_count: input.items.length, grand_total: grandTotal }),
    },
  });

  return { id: purchase.id, referenceNo, orderStatus: input.orderStatus, grandTotal, baseGrandTotal, itemCount: input.items.length };
}
