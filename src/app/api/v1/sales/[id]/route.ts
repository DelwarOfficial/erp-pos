// GET /api/v1/sales/{id} — single sale with items, payments, customer, biller, branch
//
// Posted sales are IMMUTABLE (the production trigger
// `0002_prevent_posted_record_mutation.sql` blocks UPDATE/DELETE on posted
// rows). Voiding is the sanctioned mutation path and is exposed via the
// sibling `/void` subroute. This route is read-only.

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
    await requirePermission(auth, 'sale.read');
    const { id } = await params;

    // findFirst so the tenantClient extension can inject the company_id filter
    // as RLS-equivalent defence-in-depth (belt + braces with the explicit
    // `companyId` predicate below).
    const sale = await db.sale.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true } },
        biller: { select: { id: true, name: true, email: true } },
        branch: { select: { id: true, name: true, code: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        currency: { select: { code: true, name: true, decimalPlaces: true } },
        cashierShift: { select: { id: true, status: true, openedAt: true, closedAt: true } },
        voidedByUser: { select: { id: true, name: true, email: true } },
        items: {
          orderBy: { lineNo: 'asc' },
          include: {
            product: { select: { id: true, name: true, code: true } },
          },
        },
        payments: {
          orderBy: { allocatedAt: 'asc' },
          include: {
            payment: {
              select: {
                id: true,
                referenceNo: true,
                paymentMethod: true,
                paymentStatus: true,
                financialAccount: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!sale) {
      throw new DomainError(
        'RESOURCE_NOT_FOUND',
        'Sale not found',
        { sale_id: id },
        404,
      );
    }

    // Branch scope check — non-global users may only read sales in branches
    // they are scoped to. This mirrors the `requirePermission(auth, perm,
    // branchId)` enforcement used in the write paths.
    if (!auth.isGlobal && !auth.branchIds.includes(sale.branchId)) {
      throw new DomainError(
        'FORBIDDEN_SCOPE',
        'Branch access denied for this sale',
        { branch_id: sale.branchId },
        403,
      );
    }

    return NextResponse.json({
      id: sale.id,
      reference_no: sale.referenceNo,
      client_txn_id: sale.clientTxnId,
      sale_status: sale.saleStatus,
      business_date: sale.businessDate,
      currency_code: sale.currencyCode,
      currency: sale.currency,
      exchange_rate: sale.exchangeRate.toString(),
      subtotal: sale.subtotal.toString(),
      discount_total: sale.discountTotal.toString(),
      tax_total: sale.taxTotal.toString(),
      shipping_total: sale.shippingTotal.toString(),
      grand_total: sale.grandTotal.toString(),
      base_grand_total: sale.baseGrandTotal.toString(),
      sale_note: sale.saleNote,
      offline_created_at: sale.offlineCreatedAt,
      posted_at: sale.postedAt,
      voided_at: sale.voidedAt,
      voided_by: sale.voidedBy,
      voided_by_user: sale.voidedByUser,
      created_at: sale.createdAt,
      customer: sale.customer,
      customer_name_snapshot: sale.customerNameSnapshot,
      customer_phone_snapshot: sale.customerPhoneSnapshot,
      biller: sale.biller,
      branch: sale.branch,
      warehouse: sale.warehouse,
      cashier_shift: sale.cashierShift,
      items: sale.items.map((i) => ({
        id: i.id,
        line_no: i.lineNo,
        product_id: i.productId,
        product: i.product,
        product_name_snapshot: i.productNameSnapshot,
        product_code_snapshot: i.productCodeSnapshot,
        unit_code_snapshot: i.unitCodeSnapshot,
        qty: i.qty.toString(),
        unit_cost_snapshot: i.unitCostSnapshot.toString(),
        unit_price_snapshot: i.unitPriceSnapshot.toString(),
        gross_amount: i.grossAmount.toString(),
        discount_amount: i.discountAmount.toString(),
        taxable_amount: i.taxableAmount.toString(),
        tax_amount: i.taxAmount.toString(),
        line_total: i.lineTotal.toString(),
        warranty_months_snapshot: i.warrantyMonthsSnapshot,
        inventory_issue_source: i.inventoryIssueSource,
      })),
      payments: sale.payments.map((p) => ({
        id: p.id,
        payment_id: p.paymentId,
        allocated_amount: p.allocatedAmount.toString(),
        allocated_base_amount: p.allocatedBaseAmount.toString(),
        allocation_source: p.allocationSource,
        allocated_at: p.allocatedAt,
        payment: p.payment,
      })),
      item_count: sale.items.length,
      payment_count: sale.payments.length,
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
