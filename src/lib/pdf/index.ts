// src/lib/pdf/index.ts
// PDF generation utilities — invoice + receipt PDFs with Bangla font support.
// Per §10 PDF/print + §20.D08 receipt format.
//
// For sandbox/dev: renders HTML to PDF using a headless browser (Puppeteer/Playwright)
// For production: uses a fast pure-JS PDF library (pdfkit) for non-browser PDFs.
//
// Bangla font: Noto Sans Bengali (https://fonts.google.com/noto/specimen/Noto+Sans+Bengali)

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ── PDF generation via Puppeteer (renders HTML → PDF) ──
// Falls back to returning the HTML string if Puppeteer is not installed.
// (We avoid bundling puppeteer by default to keep the image small.)

export interface PdfRenderOptions {
  format?: 'a4' | 'a5' | '80mm' | '58mm';
  margins?: { top: number; bottom: number; left: number; right: number }; // mm
  printBackground?: boolean;
}

const FONT_FAMILY_CSS = `
  @font-face {
    font-family: 'Noto Sans Bengali';
    src: local('Noto Sans Bengali'), local('NotoSansBengali-Regular'),
         url('https://fonts.gstatic.com/s/notosansbengali/v20/Cm-SnFtvmXjPCtiCZtmCmifVd7JkXrjWZKbeXw') format('woff2');
    font-weight: 400;
    font-display: swap;
  }
  @font-face {
    font-family: 'Noto Sans Bengali';
    src: local('Noto Sans Bengali Bold'), local('NotoSansBengali-Bold'),
         url('https://fonts.gstatic.com/s/notosansbengali/v20/Cm-SnFtvmXjPCtiCZtmCmifVd7JkXrjWZKbeXw') format('woff2');
    font-weight: 700;
    font-display: swap;
  }
`;

const FORMAT_SIZES: Record<string, { width: string; height?: string }> = {
  a4: { width: '210mm' },
  a5: { width: '148mm' },
  '80mm': { width: '80mm' },
  '58mm': { width: '58mm' },
};

/**
 * Renders the provided HTML body into a PDF byte buffer.
 * In sandbox (no puppeteer installed), returns the HTML directly with a
 * text/html content-type hint — the browser can use Ctrl+P to save as PDF.
 */
export async function renderPdf(htmlBody: string, options: PdfRenderOptions = {}): Promise<{ bytes: Uint8Array; contentType: 'application/pdf' | 'text/html' }> {
  const format = options.format ?? 'a4';
  const size = FORMAT_SIZES[format] ?? FORMAT_SIZES.a4;

  const fullHtml = `<!DOCTYPE html>
<html lang="bn"><head><meta charset="utf-8"><title>Document</title>
<style>
${FONT_FAMILY_CSS}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; font-family: 'Noto Sans Bengali', 'Hind Siliguri', sans-serif; color: #0f172a; }
@page { size: ${size.width} ${size.height ?? 'auto'}; margin: ${options.margins?.top ?? 8}mm ${options.margins?.right ?? 8}mm ${options.margins?.bottom ?? 8}mm ${options.margins?.left ?? 8}mm; }
.no-print { display: none; }
@media print { .no-print { display: none !important; } }
</style></head>
<body>${htmlBody}</body></html>`;

  // Try Puppeteer
  try {
    const puppeteer = await import('puppeteer').catch(() => null);
    if (puppeteer) {
      const browser = await puppeteer.default.launch({ headless: 'new', args: ['--no-sandbox'] });
      try {
        const page = await browser.newPage();
        await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 15_000 });
        const pdf = await page.pdf({
          format: format === 'a4' || format === 'a5' ? format : undefined,
          width: size.width,
          height: size.height,
          printBackground: options.printBackground ?? true,
          margin: options.margins ? {
            top: `${options.margins.top}mm`,
            bottom: `${options.margins.bottom}mm`,
            left: `${options.margins.left}mm`,
            right: `${options.margins.right}mm`,
          } : undefined,
        });
        return { bytes: new Uint8Array(pdf), contentType: 'application/pdf' };
      } finally {
        await browser.close();
      }
    }
  } catch (e) {
    console.warn('[pdf] Puppeteer render failed, falling back to HTML:', e instanceof Error ? e.message : e);
  }

  // Fallback: return HTML — browser's print dialog can produce a PDF
  return { bytes: new TextEncoder().encode(fullHtml), contentType: 'text/html' };
}

// ── Receipt HTML template ──
export interface ReceiptTemplateData {
  branchName: string;
  branchAddress?: string;
  branchPhone?: string;
  vatRegistrationNo?: string;
  referenceNo: string;
  businessDate: Date;
  cashierName: string;
  items: Array<{ name: string; qty: number; unitPrice: number; lineTotal: number; discount?: number }>;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  paidAmount: number;
  changeAmount: number;
  paymentMethod: string;
  customerName?: string;
  customerPhone?: string;
  footer?: string;
  isReturn?: boolean;
}

export function renderReceiptHtml(data: ReceiptTemplateData): string {
  const width = '76mm';
  const items = data.items.map((item) => `
    <tr>
      <td colspan="4" class="item-name">${escapeHtml(item.name)}</td>
    </tr>
    <tr>
      <td></td>
      <td class="qty">x${item.qty}</td>
      <td class="price">${item.unitPrice.toFixed(2)}</td>
      <td class="total">${item.lineTotal.toFixed(2)}</td>
    </tr>
    ${item.discount && item.discount > 0 ? `<tr><td colspan="4" class="discount">Discount: -৳${item.discount.toFixed(2)}</td></tr>` : ''}
  `).join('');

  return `
    <div class="receipt" style="width:${width};margin:0 auto;font-size:11px;">
      <div class="header" style="text-align:center;border-bottom:1px dashed #000;padding-bottom:4px;margin-bottom:4px;">
        <h2 style="margin:0;font-size:14px;">${escapeHtml(data.branchName)}</h2>
        ${data.branchAddress ? `<p style="margin:2px 0;">${escapeHtml(data.branchAddress)}</p>` : ''}
        ${data.branchPhone ? `<p style="margin:2px 0;">Phone: ${escapeHtml(data.branchPhone)}</p>` : ''}
        ${data.vatRegistrationNo ? `<p style="margin:2px 0;">BIN: ${escapeHtml(data.vatRegistrationNo)}</p>` : ''}
      </div>
      <div style="margin-bottom:4px;">
        <strong>${data.isReturn ? 'RETURN' : 'INVOICE'}:</strong> ${escapeHtml(data.referenceNo)}<br>
        Date: ${data.businessDate.toLocaleString('en-GB')}<br>
        Cashier: ${escapeHtml(data.cashierName)}<br>
        ${data.customerName ? `Customer: ${escapeHtml(data.customerName)}<br>` : ''}
        ${data.customerPhone ? `Phone: ${escapeHtml(data.customerPhone)}<br>` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid #000;font-size:10px;">
            <th style="text-align:left;">Item</th>
            <th style="text-align:center;">Qty</th>
            <th style="text-align:right;">Price</th>
            <th style="text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>${items}</tbody>
      </table>
      <div style="margin-top:4px;border-top:1px dashed #000;padding-top:4px;">
        <div style="display:flex;justify-content:space-between;"><span>Subtotal:</span><span>৳ ${data.subtotal.toFixed(2)}</span></div>
        ${data.discountTotal > 0 ? `<div style="display:flex;justify-content:space-between;"><span>Discount:</span><span>-৳ ${data.discountTotal.toFixed(2)}</span></div>` : ''}
        ${data.taxTotal > 0 ? `<div style="display:flex;justify-content:space-between;"><span>VAT:</span><span>৳ ${data.taxTotal.toFixed(2)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:13px;border-top:1px solid #000;padding-top:2px;margin-top:2px;">
          <span>TOTAL:</span><span>৳ ${data.grandTotal.toFixed(2)}</span>
        </div>
      </div>
      <div style="margin-top:4px;border-top:1px dashed #000;padding-top:4px;">
        <div style="display:flex;justify-content:space-between;"><span>Paid (${escapeHtml(data.paymentMethod)}):</span><span>৳ ${data.paidAmount.toFixed(2)}</span></div>
        ${data.changeAmount > 0 ? `<div style="display:flex;justify-content:space-between;"><span>Change:</span><span>৳ ${data.changeAmount.toFixed(2)}</span></div>` : ''}
      </div>
      <div style="text-align:center;margin-top:8px;font-size:10px;">
        <p>${escapeHtml(data.footer ?? 'ধন্যবাদ — Thank you!')}</p>
        <p>Return policy: 7 days with original receipt</p>
      </div>
    </div>
  `;
}

// ── Invoice HTML template (A4) ──
export interface InvoiceTemplateData {
  companyName: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  vatRegistrationNo?: string;
  invoiceNo: string;
  invoiceDate: Date;
  dueDate?: Date;
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
  customerTaxId?: string;
  items: Array<{ name: string; description?: string; qty: number; unitPrice: number; lineTotal: number; taxRate?: number }>;
  subtotal: number;
  taxTotal: number;
  sdTotal?: number;
  discountTotal: number;
  grandTotal: number;
  notes?: string;
}

export function renderInvoiceHtml(data: InvoiceTemplateData): string {
  const items = data.items.map((item, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>
        <strong>${escapeHtml(item.name)}</strong>
        ${item.description ? `<br><span style="color:#64748b;font-size:11px;">${escapeHtml(item.description)}</span>` : ''}
      </td>
      <td style="text-align:center;">${item.qty}</td>
      <td style="text-align:right;">৳ ${item.unitPrice.toFixed(2)}</td>
      <td style="text-align:right;">${item.taxRate ? `${item.taxRate}%` : '—'}</td>
      <td style="text-align:right;">৳ ${item.lineTotal.toFixed(2)}</td>
    </tr>
  `).join('');

  return `
    <div style="padding:20px;font-size:13px;color:#0f172a;">
      <div style="display:flex;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:16px;margin-bottom:16px;">
        <div>
          <h1 style="margin:0;font-size:24px;">${escapeHtml(data.companyName)}</h1>
          ${data.companyAddress ? `<p style="margin:4px 0;color:#475569;">${escapeHtml(data.companyAddress)}</p>` : ''}
          ${data.companyPhone ? `<p style="margin:4px 0;color:#475569;">Phone: ${escapeHtml(data.companyPhone)}</p>` : ''}
          ${data.companyEmail ? `<p style="margin:4px 0;color:#475569;">Email: ${escapeHtml(data.companyEmail)}</p>` : ''}
          ${data.vatRegistrationNo ? `<p style="margin:4px 0;color:#475569;">VAT: ${escapeHtml(data.vatRegistrationNo)}</p>` : ''}
        </div>
        <div style="text-align:right;">
          <h2 style="margin:0;font-size:32px;color:#0f172a;">INVOICE</h2>
          <p style="margin:4px 0;"><strong>No:</strong> ${escapeHtml(data.invoiceNo)}</p>
          <p style="margin:4px 0;"><strong>Date:</strong> ${data.invoiceDate.toLocaleDateString('en-GB')}</p>
          ${data.dueDate ? `<p style="margin:4px 0;"><strong>Due:</strong> ${data.dueDate.toLocaleDateString('en-GB')}</p>` : ''}
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <strong style="display:block;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Bill To</strong>
        <p style="margin:4px 0;font-size:15px;"><strong>${escapeHtml(data.customerName)}</strong></p>
        ${data.customerAddress ? `<p style="margin:2px 0;color:#475569;">${escapeHtml(data.customerAddress)}</p>` : ''}
        ${data.customerPhone ? `<p style="margin:2px 0;color:#475569;">Phone: ${escapeHtml(data.customerPhone)}</p>` : ''}
        ${data.customerTaxId ? `<p style="margin:2px 0;color:#475569;">Tax ID: ${escapeHtml(data.customerTaxId)}</p>` : ''}
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <thead>
          <tr style="background:#0f172a;color:#fff;">
            <th style="padding:8px;text-align:left;">#</th>
            <th style="padding:8px;text-align:left;">Item</th>
            <th style="padding:8px;text-align:center;">Qty</th>
            <th style="padding:8px;text-align:right;">Unit Price</th>
            <th style="padding:8px;text-align:center;">VAT</th>
            <th style="padding:8px;text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>${items}</tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
        <div style="width:280px;">
          <div style="display:flex;justify-content:space-between;padding:4px 0;">
            <span>Subtotal:</span><span>৳ ${data.subtotal.toFixed(2)}</span>
          </div>
          ${data.discountTotal > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 0;color:#dc2626;"><span>Discount:</span><span>-৳ ${data.discountTotal.toFixed(2)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:4px 0;">
            <span>VAT:</span><span>৳ ${data.taxTotal.toFixed(2)}</span>
          </div>
          ${data.sdTotal && data.sdTotal > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>SD:</span><span>৳ ${data.sdTotal.toFixed(2)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:8px 0;font-weight:bold;font-size:16px;border-top:2px solid #0f172a;margin-top:4px;">
            <span>Grand Total:</span><span>৳ ${data.grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      ${data.notes ? `<div style="margin-top:24px;padding:12px;background:#f8fafc;border-left:3px solid #0f172a;"><strong>Notes:</strong><br>${escapeHtml(data.notes)}</div>` : ''}

      <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;color:#64748b;font-size:11px;">
        <p>Thank you for your business. This invoice is computer-generated and valid without signature.</p>
      </div>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Bangla number formatting (Bengali digits) ──
export function toBengaliNumber(n: number | string): string {
  const map = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(n).replace(/[0-9]/g, (d) => map[parseInt(d, 10)]);
}
