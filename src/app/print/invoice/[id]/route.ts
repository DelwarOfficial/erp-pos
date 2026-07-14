import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cookies } from 'next/headers';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { renderInvoiceHtml, renderPdf, type InvoiceTemplateData } from '@/lib/pdf';

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
      items: { include: { product: { select: { name: true, code: true, description: true } } } },
      branch: { select: { name: true, address: true, phone: true } },
      company: { select: { displayName: true, legalName: true, bin: true, tin: true } },
      customer: { select: { name: true, phone: true, address: true, taxIdentifier: true } },
    },
  });
  if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const format = new URL(req.url).searchParams.get('format') ?? 'html';

  const data: InvoiceTemplateData = {
    companyName: sale.company.displayName,
    companyAddress: sale.branch.address ?? undefined,
    companyPhone: sale.branch.phone ?? undefined,
    companyEmail: undefined,
    vatRegistrationNo: sale.company.bin ?? sale.company.tin ?? undefined,
    invoiceNo: sale.referenceNo,
    invoiceDate: new Date(sale.businessDate),
    customerName: sale.customer?.name ?? 'Walk-in Customer',
    customerAddress: sale.customer?.address ?? undefined,
    customerPhone: sale.customer?.phone ?? undefined,
    customerTaxId: sale.customer?.taxIdentifier ?? undefined,
    items: sale.items.map((item: any) => ({
      name: `${item.product.code} — ${item.product.name}`,
      description: item.product.description ?? undefined,
      qty: parseFloat(item.qty),
      unitPrice: parseFloat(item.unitPriceSnapshot),
      lineTotal: parseFloat(item.lineTotal),
      taxRate: parseFloat(item.taxRateSnapshot || '0'),
    })),
    subtotal: parseFloat(sale.subtotal),
    taxTotal: parseFloat(sale.taxTotal),
    discountTotal: parseFloat(sale.discountTotal),
    grandTotal: parseFloat(sale.grandTotal),
  };

  // ── PDF format ──
  if (format === 'pdf') {
    const htmlBody = renderInvoiceHtml(data);
    const { bytes, contentType } = await renderPdf(htmlBody, {
      format: 'a4',
      margins: { top: 15, bottom: 15, left: 15, right: 15 },
    });
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="invoice-${sale.referenceNo}.pdf"`,
      },
    });
  }

  // ── HTML format (default) ──
  const htmlBody = renderInvoiceHtml(data);
  const fullHtml = `<!DOCTYPE html><html lang="bn"><head><meta charset="utf-8"><title>Invoice ${sale.referenceNo}</title>
    <style>
      @font-face { font-family: 'Noto Sans Bengali'; src: local('Noto Sans Bengali'), url('https://fonts.gstatic.com/s/notosansbengali/v20/Cm-SnFtvmXjPCtiCZtmCmifVd7JkXrjWZKbeXw') format('woff2'); font-display: swap; }
      html, body { margin: 0; padding: 0; }
      body { font-family: 'Noto Sans Bengali', 'Hind Siliguri', Arial, sans-serif; background: #f1f5f9; }
      .page { max-width: 210mm; background: white; margin: 0 auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
      .no-print { display: block; position: fixed; top: 12px; right: 12px; }
      @media print {
        .no-print { display: none; }
        body { background: white; }
        .page { box-shadow: none; max-width: none; }
        @page { size: A4; margin: 15mm; }
      }
    </style></head><body>
    <div class="page">${htmlBody}</div>
    <div class="no-print"><button onclick="window.print()" style="padding:8px 16px;background:#0f172a;color:white;border:none;border-radius:6px;cursor:pointer;">Print</button></div>
    </body></html>`;
  return new NextResponse(fullHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
