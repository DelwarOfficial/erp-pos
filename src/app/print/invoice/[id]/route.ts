import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { runInTenantContext } from '@/lib/db/transaction';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { renderInvoiceHtml, renderPdf, type InvoiceTemplateData } from '@/lib/pdf';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
  const { id } = await params;
  const auth = await authenticateRequest();
  await requirePermission(auth, 'sale.read');
  const companyId = auth.companyId;
  const sale = await runInTenantContext(auth.ctx, async () => {
    return db.sale.findFirst({
      where: { id, companyId },
      include: {
        items: {
          include: {
            product: { select: { name: true, code: true, description: true } },
            taxes: { include: { taxComponent: { select: { componentType: true, componentCode: true } } } },
            serials: { include: { serial: { select: { serialNumber: true, warrantyExpiryDate: true } } } },
          },
          orderBy: { lineNo: 'asc' },
        },
        biller: { select: { name: true } },
        // Only money that actually landed: a pending, failed or reversed
        // payment (e.g. a bounced cheque) is not "paid". Same rule as
        // ServiceWorkflow's paid check.
        payments: { where: { payment: { paymentStatus: 'posted' } }, select: { allocatedAmount: true } },
        branch: { select: { name: true, address: true, phone: true } },
        company: { select: { displayName: true, legalName: true, bin: true, tin: true } },
        customer: { select: { name: true, phone: true, address: true, taxIdentifier: true } },
      },
    });
  });
  if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await requirePermission(auth, 'sale.read', sale.branchId);

  const format = new URL(req.url).searchParams.get('format') ?? 'html';

  // Compute supplementary duty (SD) total — sum of sale_item_taxes where the
  // underlying tax_component.componentType === 'SD'.
  let sdTotal = 0;
  for (const item of sale.items) {
    for (const sit of item.taxes ?? []) {
      if (sit.taxComponent?.componentType === 'SD') {
        sdTotal += parseFloat(sit.taxAmount.toString());
      }
    }
  }

  const data: InvoiceTemplateData = {
    companyName: sale.company.displayName,
    companyLegalName: sale.company.legalName ?? undefined,
    branchName: sale.branch.name,
    status: sale.saleStatus,
    servedBy: sale.biller?.name ?? undefined,
    companyAddress: sale.branch.address ?? undefined,
    companyPhone: sale.branch.phone ?? undefined,
    companyEmail: undefined,
    vatRegistrationNo: sale.company.bin ?? sale.company.tin ?? undefined,
    invoiceNo: sale.referenceNo,
    invoiceDate: new Date(sale.businessDate),
    customerName: sale.customer?.name ?? sale.customerNameSnapshot ?? 'Walk-in customer',
    customerAddress: sale.customer?.address ?? undefined,
    customerPhone: sale.customer?.phone ?? sale.customerPhoneSnapshot ?? undefined,
    customerTaxId: sale.customer?.taxIdentifier ?? undefined,
    items: sale.items.map(item => ({
      // Names and codes as they were when sold, not as the product reads today.
      name: item.productNameSnapshot,
      code: item.productCodeSnapshot,
      description: item.product.description ?? undefined,
      unit: item.unitCodeSnapshot,
      qty: parseFloat(String(item.qty)),
      unitPrice: parseFloat(String(item.unitPriceSnapshot)),
      discount: parseFloat(String(item.discountAmount)) || undefined,
      warrantyMonths: item.warrantyMonthsSnapshot ?? undefined,
      serials: item.serials.map(s => ({ serialNumber: s.serial.serialNumber, warrantyUntil: s.serial.warrantyExpiryDate ?? undefined })),
      lineTotal: parseFloat(String(item.lineTotal)),
      taxRate: item.taxes.reduce((sum, tax) => sum + Number(tax.rateSnapshot), 0),
    })),
    subtotal: parseFloat(String(sale.subtotal)),
    taxTotal: parseFloat(String(sale.taxTotal)),
    sdTotal,
    discountTotal: parseFloat(String(sale.discountTotal)),
    grandTotal: parseFloat(String(sale.grandTotal)),
    // Summed as decimals, then converted once, so paisa do not drift.
    amountPaid: sale.payments.reduce((sum, a) => sum.plus(a.allocatedAmount), new Prisma.Decimal(0)).toNumber(),
    notes: sale.saleNote ?? undefined,
  };

  // ── PDF format ──
  if (format === 'pdf') {
    const htmlBody = renderInvoiceHtml(data);
    const { bytes, contentType } = await renderPdf(htmlBody, {
      format: 'a4',
      margins: { top: 10, bottom: 10, left: 10, right: 10 },
    });
    return new NextResponse(new Uint8Array(bytes) as BodyInit, {
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
      body { font-family: 'Segoe UI', 'Noto Sans Bengali', 'Hind Siliguri', Arial, sans-serif; background: #e2e8f0; }
      /* On screen: an A4 sheet. On paper: the browser's A4 page with 10 mm margins. */
      .page { width: 210mm; min-height: 297mm; box-sizing: border-box; background: white; margin: 16px auto; box-shadow: 0 10px 30px -10px rgba(15,23,42,0.35); }
      .no-print { display: block; position: fixed; top: 12px; right: 12px; }
      @page { size: A4; margin: 10mm; }
      @media print {
        .no-print { display: none; }
        body { background: white; }
        .page { width: auto; min-height: 0; margin: 0; box-shadow: none; }
      }
    </style></head><body>
    <div class="page">${htmlBody}</div>
    <div class="no-print"><button onclick="window.print()" style="min-height:44px;padding:10px 18px;background:#0f4c81;color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Print / Save PDF</button></div>
    </body></html>`;
  return new NextResponse(fullHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error, getCorrelationId(req)); }
}
