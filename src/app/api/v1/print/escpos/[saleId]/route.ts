import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runInTenantContext } from '@/lib/db/transaction';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { buildReceiptBytes } from '@/lib/escpos';
import { DomainError } from '@/lib/errors/codes';

// GET /api/v1/print/escpos/[saleId]
// Returns raw ESC/POS bytes for the sale receipt; the till's print bridge
// sends them to its printer.
//
// The server never connects to a printer. A `printer=host:port` parameter
// used to open a raw TCP socket to any host, loopback and cloud metadata
// included (red-team workstream 3: SSRF, receipt data sent anywhere, port
// probing). It is refused before anything else happens.
export async function GET(req: NextRequest, { params }: { params: Promise<{ saleId: string }> }) {
  let auth;
  try {
    auth = await authenticateRequest();
    await requirePermission(auth, 'sale.read');
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL', message: 'Authentication failed' } }, { status: 500 });
  }
  

  if (new URL(req.url).searchParams.has('printer')) {
    return NextResponse.json({ error: { code: 'VALIDATION_FAILED',
      message: "The server does not send receipts to network printers. Download the receipt and print it through the till's print bridge." } }, { status: 400 });
  }

  const { saleId } = await params;
  // NOTE: auth.companyId (not company_id) — the latter is undefined and would
  // silently drop the tenant scope. Explicit context + correct field.
  const sale = await runInTenantContext(auth.ctx, async () => {
    return db.sale.findFirst({
      where: { id: saleId, companyId: auth.companyId },
    include: {
      items: { include: { product: { select: { name: true, code: true } } } },
      branch: { select: { name: true, phone: true, address: true } },
      payments: true,
      biller: { select: { name: true } },
      customer: { select: { name: true, phone: true } },
      },
    });
  });
  if (!sale) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Sale not found' } }, { status: 404 });

  const bytes = buildReceiptBytes({
    branchName: sale.branch.name,
    branchAddress: sale.branch.address ?? undefined,
    branchPhone: sale.branch.phone ?? undefined,
    referenceNo: sale.referenceNo,
    businessDate: new Date(sale.businessDate),
    cashierName: sale.biller?.name ?? '—',
    items: sale.items.map((item: any) => ({
      name: item.product.name,
      qty: parseFloat(String(item.qty)),
      unitPrice: parseFloat(String(item.unitPriceSnapshot)),
      lineTotal: parseFloat(String(item.lineTotal)),
    })),
    subtotal: parseFloat(String(sale.subtotal)),
    discountTotal: parseFloat(String(sale.discountTotal)),
    taxTotal: parseFloat(String(sale.taxTotal)),
    grandTotal: parseFloat(String(sale.grandTotal)),
    paidAmount: sale.payments.reduce((s: number, p: any) => s + parseFloat(String(p.amount)), 0),
    changeAmount: 0,
    paymentMethod: sale.payments.map((p: any) => p.method).join(', ') || 'cash',
    customerName: sale.customer?.name,
    customerPhone: sale.customer?.phone ?? undefined,
    isReturn: (sale as any).saleType === 'return',
  });

  return new NextResponse(new Uint8Array(bytes) as BodyInit, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `inline; filename="receipt-${sale.referenceNo}.bin"`,
    },
  });
}
