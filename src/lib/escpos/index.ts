// src/lib/escpos/index.ts
// ESC/POS thermal printer command builder for 58mm/80mm receipt printers.
// Per §10 receipt printing + §20.D08 receipt format rules.
//
// Generates a raw byte buffer that can be:
//   - Sent to a network printer via raw TCP (port 9100)
//   - Pushed through WebUSB / WebHID in the browser
//   - Saved as a .bin file for manual printing
//
// Spec: Epson ESC/POS command reference ( GS v, ESC !, ESC a, etc.)

// ── ESC/POS control codes ──
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// ── Low-level command builders ──
function init(): number[] { return [ESC, 0x40]; /* ESC @ — initialize */ }
function feed(n = 1): number[] { return [ESC, 0x64, n]; /* ESC d n — feed n lines */ }
function cut(): number[] { return [GS, 0x56, 0x42, 0x00]; /* GS V B 0 — partial cut */ }
function align(a: 'left' | 'center' | 'right'): number[] {
  const n = a === 'center' ? 1 : a === 'right' ? 2 : 0;
  return [ESC, 0x61, n]; /* ESC a n */
}
function bold(on: boolean): number[] { return [ESC, 0x45, on ? 1 : 0]; /* ESC E n */ }
function size(width = 1, height = 1): number[] { return [GS, 0x21, ((width - 1) << 4) | (height - 1)]; /* GS ! n */ }
function text(s: string): number[] {
  // Convert UTF-8 string → byte array (Bangla characters will render if the printer has a Bangla codepage)
  return Array.from(new TextEncoder().encode(s));
}
function textLine(s: string): number[] { return [...text(s), LF]; }
function separator(): number[] { return [...text('-'.repeat(32)), LF]; }

// ── High-level receipt builder ──
export interface ReceiptData {
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
  footer?: string; // optional custom footer line
  isReturn?: boolean;
}

export function buildReceiptBytes(data: ReceiptData): Uint8Array {
  const bytes: number[] = [];
  bytes.push(...init());

  // ── Header ──
  bytes.push(...align('center'));
  bytes.push(...bold(true));
  bytes.push(...size(2, 2));
  bytes.push(...textLine(data.branchName));
  bytes.push(...size(1, 1));
  bytes.push(...bold(false));
  if (data.branchAddress) bytes.push(...textLine(data.branchAddress));
  if (data.branchPhone) bytes.push(...textLine(`Phone: ${data.branchPhone}`));
  if (data.vatRegistrationNo) bytes.push(...textLine(`VAT: ${data.vatRegistrationNo}`));
  bytes.push(...separator());

  // ── Receipt meta ──
  bytes.push(...align('left'));
  bytes.push(...bold(true));
  bytes.push(...textLine(`${data.isReturn ? 'RETURN' : 'INVOICE'}: ${data.referenceNo}`));
  bytes.push(...bold(false));
  bytes.push(...textLine(`Date: ${data.businessDate.toLocaleString('en-GB')}`));
  bytes.push(...textLine(`Cashier: ${data.cashierName}`));
  if (data.customerName) bytes.push(...textLine(`Customer: ${data.customerName}`));
  if (data.customerPhone) bytes.push(...textLine(`Phone: ${data.customerPhone}`));
  bytes.push(...separator());

  // ── Items ──
  // Headers
  bytes.push(...bold(true));
  bytes.push(...textLine(padLine('Item', 'Qty', 'Price', 'Total')));
  bytes.push(...bold(false));
  bytes.push(...separator());

  for (const item of data.items) {
    bytes.push(...textLine(truncate(item.name, 32)));
    bytes.push(...textLine(padLine('', `x${item.qty}`, item.unitPrice.toFixed(2), item.lineTotal.toFixed(2))));
    if (item.discount && item.discount > 0) {
      bytes.push(...textLine(`   Discount: -৳${item.discount.toFixed(2)}`));
    }
  }
  bytes.push(...separator());

  // ── Totals ──
  bytes.push(...align('right'));
  bytes.push(...textLine(`Subtotal: ৳${data.subtotal.toFixed(2)}`));
  if (data.discountTotal > 0) bytes.push(...textLine(`Discount: -৳${data.discountTotal.toFixed(2)}`));
  if (data.taxTotal > 0) bytes.push(...textLine(`VAT: ৳${data.taxTotal.toFixed(2)}`));
  bytes.push(...bold(true));
  bytes.push(...size(2, 2));
  bytes.push(...textLine(`TOTAL: ৳${data.grandTotal.toFixed(2)}`));
  bytes.push(...size(1, 1));
  bytes.push(...bold(false));
  bytes.push(...separator());

  // ── Payment ──
  bytes.push(...textLine(`Paid (${data.paymentMethod}): ৳${data.paidAmount.toFixed(2)}`));
  if (data.changeAmount > 0) bytes.push(...textLine(`Change: ৳${data.changeAmount.toFixed(2)}`));
  bytes.push(...separator());

  // ── Footer ──
  bytes.push(...align('center'));
  bytes.push(...textLine(data.footer ?? 'ধন্যবাদ — Thank you!'));
  bytes.push(...textLine('Return policy: 7 days with original receipt'));
  bytes.push(...feed(2));
  bytes.push(...cut());

  return new Uint8Array(bytes);
}

// ── Helpers ──
function padLine(c1: string, c2: string, c3: string, c4: string, width = 32): string {
  // Layout: c1 | c2 (right) | c3 (right) | c4 (right)
  // Distribute width: c1 = 14, c2 = 4, c3 = 6, c4 = 8
  const w1 = 14, w2 = 4, w3 = 6, w4 = 8;
  return (
    c1.padEnd(w1).slice(0, w1) +
    c2.padStart(w2).slice(0, w2) +
    c3.padStart(w3).slice(0, w3) +
    c4.padStart(w4).slice(0, w4)
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// ── Network printer delivery ──
/**
 * Send ESC/POS bytes to a network printer via raw TCP (port 9100 by default).
 * Browser-side this requires WebSockets or a local print server bridge.
 * Server-side this uses Node.js net.Socket directly.
 */
export async function sendToNetworkPrinter(
  bytes: Uint8Array,
  host: string,
  port = 9100,
  timeoutMs = 5000,
): Promise<{ sent: boolean; error?: string }> {
  if (typeof window !== 'undefined') {
    // Browser — must use a local bridge (e.g., https://localhost:9100 via fetch)
    // Defer to the print route which renders the bytes for the browser to send.
    return { sent: false, error: 'Browser cannot open raw TCP sockets — use /api/v1/print/escpos/[saleId] route or local print bridge' };
  }

  try {
    const { Socket } = await import('node:net');
    return await new Promise((resolve) => {
      const socket = new Socket();
      socket.setTimeout(timeoutMs);
      socket.on('error', (err) => { socket.destroy(); resolve({ sent: false, error: err.message }); });
      socket.on('timeout', () => { socket.destroy(); resolve({ sent: false, error: 'Printer connection timed out' }); });
      socket.on('connect', () => {
        socket.write(Buffer.from(bytes), () => socket.end());
      });
      socket.on('close', () => resolve({ sent: true }));
      socket.connect(port, host);
    });
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
