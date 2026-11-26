// A4 invoice template: totals, balance due, and the warranty section.

import { describe, expect, it } from 'vitest';
import { renderInvoiceHtml, type InvoiceTemplateData } from '../../src/lib/pdf';

const base: InvoiceTemplateData = {
  companyName: 'Demo Electronics',
  invoiceNo: 'INV-DHK-000009',
  invoiceDate: new Date('2026-11-26T06:00:00.000Z'),
  status: 'completed',
  customerName: 'Arif <script>',
  items: [
    { name: 'Smart TV 43', code: 'TV-43', unit: 'PCS', qty: 1, unitPrice: 32000, discount: 2000, lineTotal: 30000,
      warrantyMonths: 12, serials: [{ serialNumber: 'SN-001', warrantyUntil: new Date('2027-11-26T06:00:00.000Z') }] },
    { name: 'Ceiling Fan', unit: 'PCS', qty: 2, unitPrice: 2500, lineTotal: 5000, warrantyMonths: 6 },
    { name: 'HDMI cable', qty: 1, unitPrice: 300, lineTotal: 300 },
  ],
  subtotal: 37300, discountTotal: 2000, taxTotal: 0, grandTotal: 35300, amountPaid: 30000,
};

describe('A4 invoice', () => {
  const html = renderInvoiceHtml(base);

  it('keeps its colours when printed', () => {
    expect(html).toContain('print-color-adjust:exact');
  });

  it('escapes customer-supplied text', () => {
    expect(html).toContain('Arif &lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('shows paid, balance due, and does not call a part-paid sale paid', () => {
    expect(html).toContain('Balance due');
    expect(html).toContain('৳ 5,300.00');
    expect(html).toContain('Completed — balance due');
    expect(html).not.toContain('Paid &amp; completed');
  });

  it('lists warranty per serial, and per line without one', () => {
    expect(html).toContain('>Warranty<');
    expect(html).toContain('SN-001');
    expect(html).toContain('26 Nov 2027'); // the serial's own end date
    expect(html).toContain('26 May 2027'); // sale date + 6 months for the fan
    expect(html).not.toMatch(/HDMI cable<\/td>/); // no warranty, no warranty row
  });

  it('leaves the warranty section out when nothing has one', () => {
    const none = renderInvoiceHtml({ ...base, items: [base.items[2]] });
    expect(none).not.toContain('>Warranty<');
  });
});
