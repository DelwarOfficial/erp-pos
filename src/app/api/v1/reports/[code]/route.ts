// GET /api/v1/reports/{code} — execute a report by its code using the REPORTS registry

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { REPORTS } from '@/reports';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'report.execute');
    const { code } = await params;

    const reportFn = REPORTS[code];
    if (!reportFn) {
      throw new DomainError('RESOURCE_NOT_FOUND', `Unknown report code: ${code}`, { available: Object.keys(REPORTS) }, 404);
    }

    const url = req.nextUrl;
    const asOf = url.searchParams.get('as_of');
    const fromDate = url.searchParams.get('from');
    const toDate = url.searchParams.get('to');
    const warehouseId = url.searchParams.get('warehouse_id');

    // Each report takes (companyId, ...args) — call based on its signature.
    let result;
    switch (code) {
      case 'trial_balance':
        result = await reportFn(auth.companyId, asOf ? new Date(asOf) : undefined);
        break;
      case 'inventory_valuation':
        result = await reportFn(auth.companyId, warehouseId ?? undefined);
        break;
      case 'sales_summary':
        if (!fromDate || !toDate) {
          throw new DomainError('VALIDATION_FAILED', 'sales_summary requires from and to query params', {}, 400);
        }
        result = await reportFn(auth.companyId, new Date(fromDate), new Date(toDate));
        break;
      default: {
        // New reports accept a single ReportFilters object as their 2nd arg.
        // Legacy reports (stock_alert, ar_aging, ap_aging, dashboard_summary)
        // accept only companyId and silently ignore the extra arg.
        const limitParam = url.searchParams.get('limit');
        result = await reportFn(auth.companyId, {
          fromDate: fromDate ? new Date(fromDate) : undefined,
          toDate: toDate ? new Date(toDate) : undefined,
          asOf: asOf ? new Date(asOf) : undefined,
          warehouseId: warehouseId ?? undefined,
          branchId: url.searchParams.get('branch_id') ?? undefined,
          productId: url.searchParams.get('product_id') ?? undefined,
          customerId: url.searchParams.get('customer_id') ?? undefined,
          supplierId: url.searchParams.get('supplier_id') ?? undefined,
          serialNumber: url.searchParams.get('serial') ?? undefined,
          limit: limitParam ? parseInt(limitParam, 10) : undefined,
        });
      }
    }

    return NextResponse.json({ item: result });
  } catch (e) { return errorResponse(e, correlationId); }
}
