import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cookies } from 'next/headers';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { renderReceiptHtml, renderPdf, type ReceiptTemplateData } from '@/lib/pdf';
import { buildReceiptBytes, sendToNetworkPrinter } from '@/lib/escpos';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get('erp_access')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let companyId: string;
  try { const claims = await verifyAccessToken(token); companyId = claims.company_id; }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }); }

  const sale = await db.sale.findFirst({
    where: { id, companyId },
    include: {
      items: { include: { product: { select: { name: true, code: true } } } },
      branch: { select: { name: true, phone: true, address: true } },
      payments: true,
      biller: { select: { name: true } },
      customer: { select: { name: true, phone: true } },
    },
  });
  if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Check for format query param: ?format=pdf|html|escpos
  const format = new URL(req.url).searchParams.get('format') ?? 'html';

  const data: ReceiptTemplateData = {
    branchName: sale.branch.name,
    branchAddress: sale.branch.address ?? undefined,
    branchPhone: sale.branch.phone ?? undefined,
    referenceNo: sale.referenceNo,
    businessDate: new Date(sale.businessDate),
    cashierName: sale.biller?.name ?? '—',
    items: sale.items.map((item: any) => ({
      name: item.product.name,
      qty: parseFloat(item.qty),
      unitPrice: parseFloat(item.unitPriceSnapshot),
      lineTotal: parseFloat(item.lineTotal),
      discount: parseFloat(item.discountAmountSnapshot || '0'),
    })),
    subtotal: parseFloat(sale.subtotal),
    discountTotal: parseFloat(sale.discountTotal),
    taxTotal: parseFloat(sale.taxTotal),
    grandTotal: parseFloat(sale.grandTotal),
    paidAmount: sale.payments.reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0),
    changeAmount: 0, // computed below
    paymentMethod: sale.payments.map((p: any) => p.method).join(', ') || 'cash',
    customerName: sale.customer?.name,
    customerPhone: sale.customer?.phone ?? undefined,
    isReturn: sale.saleType === 'return',
  };
  data.changeAmount = Math.max(0, data.paidAmount - data.grandTotal);

  // ── ESC/POS raw bytes (for thermal printers) ──
  if (format === 'escpos') {
    const bytes = buildReceiptBytes(data);
    const printerHost = new URL(req.url).searchParams.get('printer');
    if (printerHost) {
      const result = await sendToNetworkPrinter(bytes, printerHost);
      return NextResponse.json(result);
    }
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `inline; filename="receipt-${sale.referenceNo}.bin"`,
      },
    });
  }

  // ── PDF (falls back to HTML if Puppeteer not installed) ──
  if (format === 'pdf') {
    const htmlBody = renderReceiptHtml(data);
    const { bytes, contentType } = await renderPdf(htmlBody, { format: '80mm' });
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="receipt-${sale.referenceNo}.pdf"`,
      },
    });
  }

  // ── HTML (default — opens print dialog) ──
  const htmlBody = renderReceiptHtml(data);
  const fullHtml = `<!DOCTYPE html><html lang="bn"><head><meta charset="utf-8"><title>Receipt ${sale.referenceNo}</title>
    <style>
      @font-face { font-family: 'Noto Sans Bengali'; src: local('Noto Sans Bengali'), url('https://fonts.gstatic.com/s/notosansbengali/v20/Cm-SnFtvmXjPCtiCZtmCmifVd7JkXrjWZKbeXw') format('woff2'); font-display: swap; }
      body { font-family: 'Noto Sans Bengali', 'Hind Siliguri', sans-serif; margin: 0; padding: 8px; background: #f1f5f9; }
      .no-print { display: block; position: fixed; top: 12px; right: 12px; }
      @media print { .no-print { display: none; } body { background: white; padding: 0; } }
    </style></head><body>
    ${htmlBody}
    <div class="no-print"><button onclick="window.print()" style="padding:8px 16px;background:#0f172a;color:white;border:none;border-radius:6px;cursor:pointer;">Print</button></div>
    </body></html>`;
  return new NextResponse(fullHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
