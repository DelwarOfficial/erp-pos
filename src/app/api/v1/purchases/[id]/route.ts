// GET /api/v1/purchases/{id} — single purchase with items, supplier, branch,
// warehouse, receivings
//
// Posted purchases are IMMUTABLE (production trigger
// `0002_prevent_posted_record_mutation.sql` blocks UPDATE/DELETE on posted
// rows). Receiving, returns, and landed-cost allocations are exposed via
// dedicated sibling subroutes. This route is read-only.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'purchase.read');
    const { id } = await params;

    // findFirst so the tenantClient extension can apply the company_id
    // filter as RLS-equivalent defence-in-depth.
    const purchase = await db.purchase.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            taxIdentifier: true,
            currencyCode: true,
            paymentTermsDays: true,
          },
        },
        branch: { select: { id: true, name: true, code: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        currency: { select: { code: true, name: true, symbol: true } },
        items: {
          orderBy: { lineNo: 'asc' },
          include: {
            product: { select: { id: true, name: true, code: true } },
          },
        },
        receivings: {
          orderBy: { receivedAt: 'desc' },
          select: {
            id: true,
            referenceNo: true,
            receivingStatus: true,
            businessDate: true,
            receivedAt: true,
            postedAt: true,
            supplierDocumentNo: true,
            notes: true,
            receivedBy: true,
            _count: { select: { items: true } },
          },
        },
      },
    });

    if (!purchase) {
      throw new DomainError(
        'RESOURCE_NOT_FOUND',
        'Purchase not found',
        { purchase_id: id },
        404,
      );
    }

    // Branch scope check — non-global users may only read purchases in
    // branches they are scoped to.
    if (!auth.isGlobal && !auth.branchIds.includes(purchase.branchId)) {
      throw new DomainError(
        'FORBIDDEN_SCOPE',
        'Branch access denied for this purchase',
        { branch_id: purchase.branchId },
        403,
      );
    }

    return NextResponse.json({
      id: purchase.id,
      reference_no: purchase.referenceNo,
      supplier_invoice_no: purchase.supplierInvoiceNo,
      order_status: purchase.orderStatus,
      invoice_status: purchase.invoiceStatus,
      currency_code: purchase.currencyCode,
      currency: purchase.currency,
      exchange_rate: purchase.exchangeRate.toString(),
      order_date: purchase.orderDate,
      expected_date: purchase.expectedDate,
      subtotal: purchase.subtotal.toString(),
      discount_total: purchase.discountTotal.toString(),
      tax_total: purchase.taxTotal.toString(),
      landed_cost_total: purchase.landedCostTotal.toString(),
      grand_total: purchase.grandTotal.toString(),
      base_grand_total: purchase.baseGrandTotal.toString(),
      notes: purchase.notes,
      created_by: purchase.createdBy,
      created_at: purchase.createdAt,
      supplier: purchase.supplier,
      branch: purchase.branch,
      warehouse: purchase.warehouse,
      items: purchase.items.map((i) => ({
        id: i.id,
        line_no: i.lineNo,
        product_id: i.productId,
        product: i.product,
        product_name_snapshot: i.productNameSnapshot,
        product_code_snapshot: i.productCodeSnapshot,
        qty_ordered: i.qtyOrdered.toString(),
        qty_received: i.qtyReceived.toString(),
        qty_returned: i.qtyReturned.toString(),
        unit_cost: i.unitCost.toString(),
        allocated_landed_cost_per_unit: i.allocatedLandedCostPerUnit.toString(),
        discount_amount: i.discountAmount.toString(),
        tax_amount: i.taxAmount.toString(),
        line_total: i.lineTotal.toString(),
      })),
      receivings: purchase.receivings.map((r) => ({
        id: r.id,
        reference_no: r.referenceNo,
        receiving_status: r.receivingStatus,
        business_date: r.businessDate,
        received_at: r.receivedAt,
        posted_at: r.postedAt,
        supplier_document_no: r.supplierDocumentNo,
        notes: r.notes,
        received_by: r.receivedBy,
        item_count: r._count.items,
      })),
      item_count: purchase.items.length,
      receiving_count: purchase.receivings.length,
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
