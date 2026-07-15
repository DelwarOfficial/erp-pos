import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth/middleware';
import { buildReceiptBytes, sendToNetworkPrinter } from '@/lib/escpos';
import { DomainError } from '@/lib/errors/codes';

// GET /api/v1/print/escpos/[saleId]?printer=192.168.1.50:9100
// Returns raw ESC/POS bytes for the sale receipt, OR forwards them to a network
// thermal printer if `printer` query param is provided.
export async function GET(req: NextRequest, { params }: { params: Promise<{ saleId: string }> }) {
  let auth;
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL', message: 'Authentication failed' } }, { status: 500 });
  }
  

  const { saleId } = await params;
  const sale = await db.sale.findFirst({
    where: { id: saleId, companyId: auth.company_id },
    include: {
      items: { include: { product: { select: { name: true, code: true } } } },
      branch: { select: { name: true, phone: true, address: true } },
      payments: true,
      biller: { select: { name: true } },
      customer: { select: { name: true, phone: true } },
    },
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

  const printerParam = new URL(req.url).searchParams.get('printer');
  if (printerParam) {
    const [host, portStr] = printerParam.split(':');
    const port = portStr ? parseInt(portStr, 10) : 9100;
    const result = await sendToNetworkPrinter(bytes, host, port);
    return NextResponse.json(result);
  }

  return new NextResponse(new Uint8Array(bytes) as BodyInit, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `inline; filename="receipt-${sale.referenceNo}.bin"`,
    },
  });
}
