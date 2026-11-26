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
import { errorMeta, logger } from '@/lib/logging';
import { formatDate, formatMoney } from '@/lib/i18n/format';

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
    // puppeteer is an optional dependency — use eval to prevent Next.js from
    // trying to bundle it at build time. If not installed, falls back to HTML.
    let puppeteer: any = null;
    try {
      puppeteer = (0, eval)('require')('puppeteer');
    } catch {
      // puppeteer not installed — fall through to HTML fallback
    }
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
    logger.warn('[pdf] Puppeteer render failed; falling back to HTML', errorMeta(e));
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
export interface InvoiceWarrantySerial {
  serialNumber: string;
  /** Warranty end recorded on the serial at sale time, when there is one. */
  warrantyUntil?: Date;
}

export interface InvoiceTemplateData {
  companyName: string;
  companyLegalName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  vatRegistrationNo?: string;
  branchName?: string;
  invoiceNo: string;
  invoiceDate: Date;
  dueDate?: Date;
  /** completed / voided / returned / partially_returned … (shown as a badge). */
  status?: string;
  servedBy?: string;
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
  customerTaxId?: string;
  items: Array<{
    name: string;
    code?: string;
    description?: string;
    unit?: string;
    qty: number;
    unitPrice: number;
    discount?: number;
    lineTotal: number;
    taxRate?: number;
    /** Warranty length captured on the sale line (months). */
    warrantyMonths?: number;
    serials?: InvoiceWarrantySerial[];
  }>;
  subtotal: number;
  taxTotal: number;
  sdTotal?: number;
  discountTotal: number;
  grandTotal: number;
  amountPaid?: number;
  notes?: string;
}

const INVOICE_LOCALE = 'en-BD' as const;
const money = (value: number) => formatMoney(value, INVOICE_LOCALE);
const day = (value: Date) => formatDate(value, INVOICE_LOCALE);

/** Warranty end for a line without a serial: sale date + the captured months. */
function warrantyEnd(start: Date, months: number): Date {
  const end = new Date(start.getTime());
  end.setUTCMonth(end.getUTCMonth() + months);
  return end;
}

const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  completed: { label: 'Paid & completed', bg: '#dcfce7', fg: '#166534' },
  voided: { label: 'Voided', bg: '#fee2e2', fg: '#991b1b' },
  returned: { label: 'Returned', bg: '#fef3c7', fg: '#92400e' },
  partially_returned: { label: 'Partly returned', bg: '#fef3c7', fg: '#92400e' },
};

/**
 * A4 tax invoice with a warranty section. Inline styles only, so the same
 * markup renders in the browser view and in the PDF renderer; colours are
 * kept on paper with print-color-adjust.
 */
export function renderInvoiceHtml(data: InvoiceTemplateData): string {
  const accent = '#0f4c81';
  const accentSoft = '#e8f0f9';
  const warm = '#f59e0b';
  const due = data.amountPaid === undefined ? undefined : Math.max(0, Math.round((data.grandTotal - data.amountPaid) * 100) / 100);
  const status = data.status ? STATUS_STYLE[data.status] ?? { label: data.status, bg: '#e2e8f0', fg: '#334155' } : undefined;
  // A completed sale with money still owed is not "paid".
  const badge = status && data.status === 'completed' && due && due > 0
    ? { label: 'Completed — balance due', bg: '#ffedd5', fg: '#9a3412' } : status;

  const rows = data.items.map((item, i) => `
    <tr style="background:${i % 2 ? '#f8fafc' : '#ffffff'};">
      <td style="padding:8px 10px;color:#64748b;vertical-align:top;">${i + 1}</td>
      <td style="padding:8px 10px;vertical-align:top;">
        <div style="font-weight:600;color:#0f172a;">${escapeHtml(item.name)}</div>
        ${item.code ? `<div style="font-size:10.5px;color:#64748b;font-family:ui-monospace,Consolas,monospace;">${escapeHtml(item.code)}</div>` : ''}
        ${item.description ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${escapeHtml(item.description)}</div>` : ''}
        ${item.serials?.length ? `<div style="font-size:10.5px;color:#475569;margin-top:3px;">S/N: ${item.serials.map(s => escapeHtml(s.serialNumber)).join(', ')}</div>` : ''}
        ${item.warrantyMonths ? `<span style="display:inline-block;margin-top:4px;padding:1px 7px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:10px;font-weight:600;">${item.warrantyMonths}-month warranty</span>` : ''}
      </td>
      <td style="padding:8px 10px;text-align:right;vertical-align:top;white-space:nowrap;">${item.qty}${item.unit ? ` <span style="color:#64748b;font-size:11px;">${escapeHtml(item.unit)}</span>` : ''}</td>
      <td style="padding:8px 10px;text-align:right;vertical-align:top;white-space:nowrap;">${money(item.unitPrice)}</td>
      <td style="padding:8px 10px;text-align:right;vertical-align:top;white-space:nowrap;color:${item.discount ? '#b91c1c' : '#94a3b8'};">${item.discount ? `−${money(item.discount)}` : '—'}</td>
      <td style="padding:8px 10px;text-align:right;vertical-align:top;white-space:nowrap;color:#475569;">${item.taxRate ? `${item.taxRate}%` : '—'}</td>
      <td style="padding:8px 10px;text-align:right;vertical-align:top;white-space:nowrap;font-weight:600;">${money(item.lineTotal)}</td>
    </tr>`).join('');

  // One warranty row per serial; lines without serials get one row per line.
  const warrantyRows = data.items.filter(item => item.warrantyMonths && item.warrantyMonths > 0).flatMap(item => {
    const fallback = warrantyEnd(data.invoiceDate, item.warrantyMonths!);
    const serials = item.serials?.length ? item.serials : [undefined];
    return serials.map(serial => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #fde68a;">${escapeHtml(item.name)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #fde68a;font-family:ui-monospace,Consolas,monospace;font-size:11px;">${serial ? escapeHtml(serial.serialNumber) : '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #fde68a;text-align:center;">${item.warrantyMonths} months</td>
        <td style="padding:6px 10px;border-bottom:1px solid #fde68a;">${day(data.invoiceDate)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #fde68a;font-weight:600;color:#92400e;">${day(serial?.warrantyUntil ?? fallback)}</td>
      </tr>`);
  }).join('');

  const totalRow = (label: string, value: string, style = '') =>
    `<div style="display:flex;justify-content:space-between;gap:16px;padding:5px 0;${style}"><span>${label}</span><span style="white-space:nowrap;">${value}</span></div>`;

  return `
  <div style="font-size:12.5px;line-height:1.45;color:#0f172a;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <div style="background:${accent};color:#fff;padding:22px 28px;display:flex;justify-content:space-between;align-items:flex-start;gap:24px;">
      <div>
        <div style="font-size:22px;font-weight:700;letter-spacing:.2px;">${escapeHtml(data.companyName)}</div>
        ${data.companyLegalName && data.companyLegalName !== data.companyName ? `<div style="opacity:.85;font-size:11.5px;">${escapeHtml(data.companyLegalName)}</div>` : ''}
        <div style="margin-top:8px;font-size:11.5px;opacity:.92;">
          ${data.branchName ? `<div>${escapeHtml(data.branchName)}</div>` : ''}
          ${data.companyAddress ? `<div>${escapeHtml(data.companyAddress)}</div>` : ''}
          ${data.companyPhone ? `<div>Phone: ${escapeHtml(data.companyPhone)}</div>` : ''}
          ${data.companyEmail ? `<div>Email: ${escapeHtml(data.companyEmail)}</div>` : ''}
          ${data.vatRegistrationNo ? `<div>BIN / VAT reg.: ${escapeHtml(data.vatRegistrationNo)}</div>` : ''}
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:30px;font-weight:800;letter-spacing:3px;">INVOICE</div>
        <div style="display:inline-block;margin-top:6px;padding:3px 10px;border-radius:4px;background:${warm};color:#1f1300;font-weight:700;font-size:12px;">${escapeHtml(data.invoiceNo)}</div>
        ${badge ? `<div style="margin-top:8px;"><span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${badge.bg};color:${badge.fg};font-size:11px;font-weight:700;">${escapeHtml(badge.label)}</span></div>` : ''}
      </div>
    </div>
    <div style="height:5px;background:${warm};"></div>

    <div style="padding:20px 28px 8px;display:grid;grid-template-columns:1.3fr 1fr;gap:16px;">
      <div style="background:${accentSoft};border-radius:8px;padding:12px 14px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${accent};">Bill to</div>
        <div style="font-size:15px;font-weight:700;margin-top:4px;">${escapeHtml(data.customerName)}</div>
        ${data.customerPhone ? `<div style="color:#334155;">Phone: ${escapeHtml(data.customerPhone)}</div>` : ''}
        ${data.customerAddress ? `<div style="color:#334155;">${escapeHtml(data.customerAddress)}</div>` : ''}
        ${data.customerTaxId ? `<div style="color:#334155;">Tax ID: ${escapeHtml(data.customerTaxId)}</div>` : ''}
      </div>
      <div style="border:1px solid #dbe4ee;border-radius:8px;padding:12px 14px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${accent};">Invoice details</div>
        <table style="width:100%;margin-top:4px;border-collapse:collapse;font-size:12px;">
          <tr><td style="color:#64748b;padding:2px 0;">Date</td><td style="text-align:right;font-weight:600;">${day(data.invoiceDate)}</td></tr>
          ${data.dueDate ? `<tr><td style="color:#64748b;padding:2px 0;">Due</td><td style="text-align:right;font-weight:600;">${day(data.dueDate)}</td></tr>` : ''}
          ${data.servedBy ? `<tr><td style="color:#64748b;padding:2px 0;">Served by</td><td style="text-align:right;font-weight:600;">${escapeHtml(data.servedBy)}</td></tr>` : ''}
          <tr><td style="color:#64748b;padding:2px 0;">Items</td><td style="text-align:right;font-weight:600;">${data.items.length}</td></tr>
        </table>
      </div>
    </div>

    <div style="padding:8px 28px 0;">
      <table style="width:100%;border-collapse:collapse;border:1px solid #dbe4ee;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:${accent};color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:.6px;">
            <th style="padding:9px 10px;text-align:left;width:28px;">#</th>
            <th style="padding:9px 10px;text-align:left;">Item</th>
            <th style="padding:9px 10px;text-align:right;">Qty</th>
            <th style="padding:9px 10px;text-align:right;">Unit price</th>
            <th style="padding:9px 10px;text-align:right;">Discount</th>
            <th style="padding:9px 10px;text-align:right;">VAT</th>
            <th style="padding:9px 10px;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div style="padding:16px 28px 0;display:flex;justify-content:space-between;gap:24px;align-items:flex-start;">
      <div style="flex:1;font-size:11.5px;color:#475569;">
        ${data.notes ? `<div style="padding:10px 12px;background:#f8fafc;border-left:3px solid ${accent};border-radius:4px;"><strong style="color:#0f172a;">Note</strong><br>${escapeHtml(data.notes)}</div>` : ''}
      </div>
      <div style="width:290px;">
        ${totalRow('Subtotal', money(data.subtotal))}
        ${data.discountTotal > 0 ? totalRow('Discount', `−${money(data.discountTotal)}`, 'color:#b91c1c;') : ''}
        ${totalRow('VAT', money(data.taxTotal))}
        ${data.sdTotal && data.sdTotal > 0 ? totalRow('Supplementary duty', money(data.sdTotal)) : ''}
        <div style="display:flex;justify-content:space-between;gap:16px;margin-top:6px;padding:10px 12px;background:${accent};color:#fff;border-radius:6px;font-size:16px;font-weight:800;">
          <span>Total</span><span style="white-space:nowrap;">${money(data.grandTotal)}</span>
        </div>
        ${data.amountPaid !== undefined ? totalRow('Paid', money(data.amountPaid), 'color:#166534;font-weight:600;') : ''}
        ${due !== undefined ? totalRow('Balance due', money(due), `font-weight:700;color:${due > 0 ? '#b45309' : '#166534'};`) : ''}
      </div>
    </div>

    ${warrantyRows ? `
    <div style="margin:20px 28px 0;border:1px solid #fcd34d;border-radius:8px;overflow:hidden;page-break-inside:avoid;break-inside:avoid;">
      <div style="background:#fef3c7;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;">
        <strong style="color:#92400e;font-size:13px;">Warranty</strong>
        <span style="font-size:10.5px;color:#92400e;">Keep this invoice. It is your proof of purchase for warranty service.</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
        <thead>
          <tr style="background:#fffbeb;color:#78350f;text-align:left;">
            <th style="padding:6px 10px;">Product</th><th style="padding:6px 10px;">Serial / IMEI</th>
            <th style="padding:6px 10px;text-align:center;">Period</th><th style="padding:6px 10px;">From</th><th style="padding:6px 10px;">Valid until</th>
          </tr>
        </thead>
        <tbody>${warrantyRows}</tbody>
      </table>
      <ul style="margin:0;padding:10px 12px 12px 28px;font-size:10.5px;color:#57534e;background:#fffdf5;">
        <li>Bring this invoice and the product (with its serial / IMEI label intact) for any warranty claim.</li>
        <li>Warranty covers manufacturing faults only. Physical damage, liquid damage, power surges and repairs by others are not covered.</li>
        <li>Repaired or replaced items keep the original warranty end date.</li>
      </ul>
    </div>` : ''}

    <div style="margin:28px 28px 0;display:flex;justify-content:space-between;gap:24px;font-size:11px;color:#475569;page-break-inside:avoid;break-inside:avoid;">
      <div style="width:42%;border-top:1px solid #94a3b8;padding-top:6px;text-align:center;">Customer signature</div>
      <div style="width:42%;border-top:1px solid #94a3b8;padding-top:6px;text-align:center;">Authorised signature</div>
    </div>
    <div style="margin-top:18px;padding:10px 28px;background:${accentSoft};text-align:center;color:${accent};font-size:11px;">
      Thank you for shopping with ${escapeHtml(data.companyName)}. This invoice is computer-generated.
    </div>
  </div>`;
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
