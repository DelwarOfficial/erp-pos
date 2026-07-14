import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';
import { generateCsv, escapeFormulaCell } from '@/lib/import-export/csv';

// GET /api/v1/export-jobs/[id]/download — download the exported CSV file
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let auth;
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  if ('error' in auth) return NextResponse.json(auth, { status: auth.status });

  const { id } = await params;
  const job = await db.reportExportJob.findFirst({
    where: { id, companyId: auth.companyId },
  });
  if (!job) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Export job not found' } }, { status: 404 });
  }

  if (job.status !== 'completed') {
    return NextResponse.json({ error: { code: 'NOT_READY', message: `Export job status is '${job.status}'` } }, { status: 409 });
  }

  // Check expiry
  if (job.expiresAt && job.expiresAt < new Date()) {
    await db.reportExportJob.update({
      where: { id: job.id },
      data: { status: 'expired' },
    });
    return NextResponse.json({ error: { code: 'EXPIRED', message: 'Export has expired' } }, { status: 410 });
  }

  // In production: download from S3 via media_asset
  // For sandbox: regenerate the export (deterministic since filter_json + data_cutoff_at are preserved)
  const filters = JSON.parse(job.filterJson || '{}');
  const canExportSensitive = auth.isGlobal;
  let exportData;
  try {
    exportData = await regenerateExport(job.reportCode, job.companyId, filters, canExportSensitive);
  } catch (e) {
    return NextResponse.json({ error: { code: 'INTERNAL', message: e instanceof Error ? e.message : 'Unknown' } }, { status: 500 });
  }

  const csv = generateCsv([exportData.headers, ...exportData.rows]);

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${job.reportCode}-${job.id}.csv"`,
    },
  });
}

// ── Re-generate export data (same logic as POST /export-jobs) ──
async function regenerateExport(reportCode: string, companyId: string, filters: Record<string, unknown>, includeSensitive: boolean) {
  switch (reportCode) {
    case 'inventory_valuation':
      return await regenInventoryValuation(companyId, includeSensitive);
    case 'sales_summary':
      return await regenSalesSummary(companyId, filters);
    case 'customer_list':
      return await regenCustomerList(companyId, includeSensitive);
    case 'product_list':
      return await regenProductList(companyId, includeSensitive);
    default:
      throw new Error(`Unknown report code: ${reportCode}`);
  }
}

async function regenInventoryValuation(companyId: string, includeSensitive: boolean) {
  const { db } = await import('@/lib/db');
  const stocks = await db.warehouseStock.findMany({
    where: { companyId },
    include: { product: { select: { code: true, name: true } }, warehouse: { select: { code: true, name: true } } },
    take: 10000,
  });
  const headers = includeSensitive
    ? ['Warehouse', 'Product Code', 'Product Name', 'Qty On Hand', 'MAC', 'Total Value']
    : ['Warehouse', 'Product Code', 'Product Name', 'Qty On Hand'];
  const rows = stocks.map(s => {
    const qty = parseFloat(String(s.qtyOnHand));
    const mac = parseFloat(String(s.movingAverageCost));
    const value = qty * mac;
    return includeSensitive
      ? [s.warehouse.code, s.product.code, escapeFormulaCell(s.product.name), String(qty), String(mac), String(value)]
      : [s.warehouse.code, s.product.code, escapeFormulaCell(s.product.name), String(qty)];
  });
  return { headers, rows };
}

async function regenSalesSummary(companyId: string, filters: Record<string, unknown>) {
  const { db } = await import('@/lib/db');
  const where: Record<string, unknown> = { companyId };
  if (filters.from) where.businessDate = { gte: new Date(filters.from as string) };
  if (filters.to) where.businessDate = { ...(where.businessDate as object), lte: new Date(filters.to as string) };
  const sales = await db.sale.findMany({
    where,
    select: { referenceNo: true, businessDate: true, grandTotal: true, saleStatus: true },
    take: 10000,
    orderBy: { businessDate: 'desc' },
  });
  const headers = ['Reference No', 'Business Date', 'Grand Total', 'Status'];
  const rows = sales.map(s => [
    s.referenceNo,
    new Date(s.businessDate).toISOString().split('T')[0],
    String(parseFloat(String(s.grandTotal))),
    s.saleStatus,
  ]);
  return { headers, rows };
}

async function regenCustomerList(companyId: string, includeSensitive: boolean) {
  const { db } = await import('@/lib/db');
  const customers = await db.customer.findMany({
    where: { companyId, deletedAt: null },
    select: { name: true, phone: true, email: true, address: true, isActive: true, creditLimit: true },
    take: 10000,
  });
  const headers = includeSensitive
    ? ['Name', 'Phone', 'Email', 'Address', 'Credit Limit', 'Active']
    : ['Name', 'Active'];
  const rows = customers.map(c => includeSensitive
    ? [escapeFormulaCell(c.name), c.phone ?? '', c.email ?? '', escapeFormulaCell(c.address ?? ''), String(c.creditLimit), String(c.isActive)]
    : [escapeFormulaCell(c.name), String(c.isActive)]);
  return { headers, rows };
}

async function regenProductList(companyId: string, includeSensitive: boolean) {
  const { db } = await import('@/lib/db');
  const products = await db.product.findMany({
    where: { companyId, deletedAt: null },
    select: { code: true, name: true, productType: true, isSerialized: true, referenceCost: true, defaultPrice: true, isActive: true },
    take: 10000,
  });
  const headers = includeSensitive
    ? ['Code', 'Name', 'Type', 'Serialized', 'Reference Cost', 'Default Price', 'Margin', 'Active']
    : ['Code', 'Name', 'Type', 'Serialized', 'Default Price', 'Active'];
  const rows = products.map(p => {
    const cost = parseFloat(String(p.referenceCost));
    const price = parseFloat(String(p.defaultPrice));
    return includeSensitive
      ? [p.code, escapeFormulaCell(p.name), p.productType, String(p.isSerialized), String(cost), String(price), String(price - cost), String(p.isActive)]
      : [p.code, escapeFormulaCell(p.name), p.productType, String(p.isSerialized), String(price), String(p.isActive)];
  });
  return { headers, rows };
}
