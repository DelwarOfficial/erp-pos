import { NextRequest, NextResponse } from 'next/server';
import { requireIdempotencyKey } from "@/lib/idempotency";
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';
import { generateCsv, escapeFormulaCell } from '@/lib/import-export/csv';

// GET /api/v1/export-jobs — list export jobs
export async function GET(req: NextRequest) {
  let auth;
    const idempotencyKey = requireIdempotencyKey(req);
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  if ('error' in auth) return NextResponse.json(auth, { status: auth.status });

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const where: Record<string, unknown> = { companyId: auth.companyId };
  if (status) where.status = status;

  const [jobs, total] = await Promise.all([
    db.reportExportJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.reportExportJob.count({ where }),
  ]);

  return NextResponse.json({
    jobs: jobs.map(j => ({
      id: j.id,
      reportCode: j.reportCode,
      format: j.format,
      status: j.status,
      filterJson: j.filterJson,
      dataCutoffAt: j.dataCutoffAt,
      expiresAt: j.expiresAt,
      errorSummary: j.errorSummary,
      createdAt: j.createdAt,
    })),
    total,
    limit,
    offset,
  });
}

// POST /api/v1/export-jobs — create + run an export job
// Body: { report_code, format, filter_json, sensitive_fields? }
// Sensitive fields (cost, margin, payroll, PII) are omitted unless the user
// has explicit field-level permission (per §6 rule 11).
export async function POST(req: NextRequest) {
  let auth;
    const idempotencyKey = requireIdempotencyKey(req);
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  if ('error' in auth) return NextResponse.json(auth, { status: auth.status });

  try {
    await requirePermission(auth, 'export.data.branch');
  } catch (e) {
    if (e instanceof DomainError && !auth.isGlobal) {
      return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    }
  }

  const body = await req.json().catch(() => ({}));
  const { report_code, format, filter_json, include_sensitive } = body;

  if (!report_code) {
    return NextResponse.json({ error: { code: 'VALIDATION_FAILED', message: 'report_code is required' } }, { status: 400 });
  }
  if (!['csv', 'xlsx', 'pdf'].includes(format)) {
    return NextResponse.json({ error: { code: 'VALIDATION_FAILED', message: 'format must be csv, xlsx, or pdf' } }, { status: 400 });
  }

  // Check sensitive-field permission
  const canExportSensitive = auth.isGlobal || auth.permissions?.includes('export.sensitive.company');
  if (include_sensitive && !canExportSensitive) {
    return NextResponse.json({
      error: { code: 'FORBIDDEN_SCOPE', message: 'You do not have permission to export sensitive fields (cost, margin, payroll, PII)' },
    }, { status: 403 });
  }

  // Create export job
  const job = await db.reportExportJob.create({
    data: {
      companyId: auth.companyId,
      requestedBy: auth.userId ?? 'unknown',
      reportCode: report_code,
      format,
      filterJson: JSON.stringify(filter_json ?? {}),
      dataCutoffAt: new Date(),
      status: 'running',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7-day retention
    },
  });

  try {
    // Generate the export data based on report code
    const exportData = await generateExportData(auth.companyId, report_code, filter_json ?? {}, include_sensitive && canExportSensitive);

    // Generate CSV (xlsx/pdf would use a library in production)
    const csv = generateCsv([exportData.headers, ...exportData.rows]);

    // Record control totals
    await db.reportExportJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        errorSummary: `Exported ${exportData.rows.length} rows`,
      },
    });

    // Store the CSV content temporarily (in production: upload to S3 + create media_asset)
    // For sandbox: return directly in the response
    return NextResponse.json({
      job: {
        id: job.id,
        reportCode,
        format,
        status: 'completed',
        rowCount: exportData.rows.length,
        controlTotals: exportData.controlTotals,
        dataCutoffAt: job.dataCutoffAt,
        expiresAt: job.expiresAt,
      },
      downloadUrl: `/api/v1/export-jobs/${job.id}/download`,
    }, { status: 201 });
  } catch (e) {
    await db.reportExportJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        errorSummary: e instanceof Error ? e.message : 'Unknown error',
      },
    });
    return NextResponse.json({ error: { code: 'INTERNAL', message: e instanceof Error ? e.message : 'Unknown' } }, { status: 500 });
  }
}

// ── Export data generators ──
// Each report code has a generator that queries the DB + returns headers + rows.
// Sensitive fields (cost, margin) are omitted unless includeSensitive is true.
async function generateExportData(
  companyId: string,
  reportCode: string,
  filters: Record<string, unknown>,
  includeSensitive: boolean,
): Promise<{ headers: string[]; rows: string[][]; controlTotals: Record<string, number> }> {
  switch (reportCode) {
    case 'inventory_valuation':
      return await exportInventoryValuation(companyId, filters, includeSensitive);
    case 'sales_summary':
      return await exportSalesSummary(companyId, filters, includeSensitive);
    case 'customer_list':
      return await exportCustomerList(companyId, filters, includeSensitive);
    case 'product_list':
      return await exportProductList(companyId, filters, includeSensitive);
    default:
      throw new Error(`Unknown report code: ${reportCode}`);
  }
}

async function exportInventoryValuation(companyId: string, _filters: Record<string, unknown>, includeSensitive: boolean) {
  const stocks = await db.warehouseStock.findMany({
    where: { companyId },
    include: { product: { select: { code: true, name: true } }, warehouse: { select: { code: true, name: true } } },
    take: 10000,
  });

  const headers = includeSensitive
    ? ['Warehouse', 'Product Code', 'Product Name', 'Qty On Hand', 'MAC', 'Total Value']
    : ['Warehouse', 'Product Code', 'Product Name', 'Qty On Hand'];

  let totalValue = 0;
  const rows = stocks.map(s => {
    const qty = parseFloat(String(s.qtyOnHand));
    const mac = parseFloat(String(s.movingAverageCost));
    const value = qty * mac;
    totalValue += value;
    return includeSensitive
      ? [s.warehouse.code, s.product.code, escapeFormulaCell(s.product.name), String(qty), String(mac), String(value)]
      : [s.warehouse.code, s.product.code, escapeFormulaCell(s.product.name), String(qty)];
  });

  return { headers, rows, controlTotals: { rowCount: rows.length, totalValue: includeSensitive ? totalValue : 0 } };
}

async function exportSalesSummary(companyId: string, filters: Record<string, unknown>, _includeSensitive: boolean) {
  const where: Record<string, unknown> = { companyId };
  if (filters.from) where.businessDate = { gte: new Date(filters.from as string) };
  if (filters.to) where.businessDate = { ...(where.businessDate as object), lte: new Date(filters.to as string) };

  const sales = await db.sale.findMany({
    where,
    select: { referenceNo: true, businessDate: true, grandTotal: true, saleStatus: true, createdAt: true },
    take: 10000,
    orderBy: { businessDate: 'desc' },
  });

  const headers = ['Reference No', 'Business Date', 'Grand Total', 'Status'];
  let totalAmount = 0;
  const rows = sales.map(s => {
    const total = parseFloat(String(s.grandTotal));
    totalAmount += total;
    return [s.referenceNo, new Date(s.businessDate).toISOString().split('T')[0], String(total), s.saleStatus];
  });

  return { headers, rows, controlTotals: { rowCount: rows.length, totalAmount } };
}

async function exportCustomerList(companyId: string, _filters: Record<string, unknown>, includeSensitive: boolean) {
  const customers = await db.customer.findMany({
    where: { companyId, deletedAt: null },
    select: { name: true, phone: true, email: true, address: true, isActive: true, creditLimit: true },
    take: 10000,
  });

  // PII fields (phone, email, address) are sensitive — only include if authorized
  const headers = includeSensitive
    ? ['Name', 'Phone', 'Email', 'Address', 'Credit Limit', 'Active']
    : ['Name', 'Active'];

  const rows = customers.map(c => {
    const row = includeSensitive
      ? [escapeFormulaCell(c.name), c.phone ?? '', c.email ?? '', escapeFormulaCell(c.address ?? ''), String(c.creditLimit), String(c.isActive)]
      : [escapeFormulaCell(c.name), String(c.isActive)];
    return row;
  });

  return { headers, rows, controlTotals: { rowCount: rows.length } };
}

async function exportProductList(companyId: string, _filters: Record<string, unknown>, includeSensitive: boolean) {
  const products = await db.product.findMany({
    where: { companyId, deletedAt: null },
    select: { code: true, name: true, productType: true, isSerialized: true, referenceCost: true, defaultPrice: true, isActive: true },
    take: 10000,
  });

  // Cost + margin are sensitive
  const headers = includeSensitive
    ? ['Code', 'Name', 'Type', 'Serialized', 'Reference Cost', 'Default Price', 'Margin', 'Active']
    : ['Code', 'Name', 'Type', 'Serialized', 'Default Price', 'Active'];

  const rows = products.map(p => {
    const cost = parseFloat(String(p.referenceCost));
    const price = parseFloat(String(p.defaultPrice));
    const margin = price - cost;
    return includeSensitive
      ? [p.code, escapeFormulaCell(p.name), p.productType, String(p.isSerialized), String(cost), String(price), String(margin), String(p.isActive)]
      : [p.code, escapeFormulaCell(p.name), p.productType, String(p.isSerialized), String(price), String(p.isActive)];
  });

  return { headers, rows, controlTotals: { rowCount: rows.length } };
}
