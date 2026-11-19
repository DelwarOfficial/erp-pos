// The till's offline store (IndexedDB, so it survives a reload or a restart):
//
//   till     – this browser's registration: device id, branch, warehouse, cash account
//   catalogue– the server's signed product snapshot (prices and per-quantity
//              line totals, tax included, worked out by the server)
//   sales    – cash sales taken offline, in the order they were taken
//
// A queued sale is sent with POST /api/v1/offline/sync, one at a time and in
// order, each with its own sequence number and key, so a resend after a lost
// reply is recognised as a duplicate and never posts twice. A sale the server
// refuses (stock gone, price changed, period locked) is kept and marked for a
// manager; it is never deleted from the device, because the cash was taken.

const DB_NAME = 'erp-pos-till';
const DB_VERSION = 1;

export interface Till {
  device_id: string;
  device_key: string;
  label: string;
  branch_id: string;
  warehouse_id: string;
  cash_account_id: string;
  next_sequence: number;
}

export interface CatalogueProduct {
  id: string; name: string; code: string; price: number; is_serialized: boolean;
  unit_code: string; primary_barcode: string | null;
  /** line_totals[n - 1]: what n units cost, tax included, as the server prices them. */
  line_totals: string[];
}

export interface Catalogue {
  products: CatalogueProduct[];
  generated_at: string;
  expires_at: string;
  signature: string;
}

export interface OfflineSalePayload {
  /** The cashier signed in when the sale was taken; only they can send it. */
  cashier_id?: string;
  branch_id: string; warehouse_id: string; currency_code: 'BDT'; exchange_rate: 1; business_date: string;
  items: Array<{ product_id: string; qty: number; unit_price: number }>;
  payments: Array<{ payment_method: 'cash'; amount: number; financial_account_id: string }>;
}

export interface QueuedSale {
  sequence: number;
  idempotency_key: string;
  payload: OfflineSalePayload;
  payload_hash: string;
  /** For the till's own list only. */
  lines: Array<{ name: string; qty: number; total: string }>;
  /** For the till's list: who took the sale. */
  cashier_name?: string;
  total: string;
  created_at: string;
  status: 'queued' | 'needs_attention';
  /** Bumped when a manager sends a refused sale again, so the retry is a new request. */
  attempt?: number;
  error?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('sales')) db.createObjectStore('sales', { keyPath: 'sequence' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(stores: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const request = body(tx);
    tx.oncomplete = () => { db.close(); resolve(request ? request.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export const getTill = () => run<Till>(['meta'], 'readonly', tx => tx.objectStore('meta').get('till') as IDBRequest<Till>);
export const saveTill = (till: Till) => run(['meta'], 'readwrite', tx => { tx.objectStore('meta').put(till, 'till'); });
export const getCatalogue = () => run<Catalogue>(['meta'], 'readonly', tx => tx.objectStore('meta').get('catalogue') as IDBRequest<Catalogue>);
export const saveCatalogue = (catalogue: Catalogue) => run(['meta'], 'readwrite', tx => { tx.objectStore('meta').put(catalogue, 'catalogue'); });
export const listSales = async () => ((await run<QueuedSale[]>(['sales'], 'readonly', tx => tx.objectStore('sales').getAll() as IDBRequest<QueuedSale[]>)) ?? [])
  .sort((a, b) => a.sequence - b.sequence);
const putSale = (sale: QueuedSale) => run(['sales'], 'readwrite', tx => { tx.objectStore('sales').put(sale); });
const deleteSale = (sequence: number) => run(['sales'], 'readwrite', tx => { tx.objectStore('sales').delete(sequence); });

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** A product's server-priced total for `qty` units, or null when the till can't sell it offline. */
export function offlineLineTotal(product: CatalogueProduct, qty: number): string | null {
  if (product.is_serialized || !Number.isInteger(qty) || qty < 1) return null;
  return product.line_totals[qty - 1] ?? null;
}

/** Exact sum of server-priced decimal amounts (posting sums unrounded line totals too). */
export function sumMoney(amounts: string[]): string {
  const scale = Math.max(0, ...amounts.map(a => (a.split('.')[1] ?? '').length));
  const unit = BigInt('1' + '0'.repeat(scale));
  const total = amounts.reduce((sum, amount) => {
    const negative = amount.startsWith('-');
    const [whole, fraction = ''] = amount.replace('-', '').split('.');
    const value = BigInt(whole) * unit + BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0');
    return sum + (negative ? -value : value);
  }, BigInt(0));
  const negative = total < BigInt(0);
  const abs = negative ? -total : total;
  const digits = scale ? String(abs % unit).padStart(scale, '0').replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${abs / unit}${digits ? `.${digits}` : ''}`;
}

/** Queue a cash sale taken offline. The total is the sum of the server's line totals. */
export async function queueCashSale(till: Till, cart: Array<{ product: CatalogueProduct; qty: number }>, cashier: { id: string; name: string }): Promise<QueuedSale> {
  const lines = cart.map(({ product, qty }) => {
    const total = offlineLineTotal(product, qty);
    if (total === null) throw new Error(`${product.name} can't be sold offline in that quantity`);
    return { name: product.name, qty, total };
  });
  const total = sumMoney(lines.map(line => line.total));
  const payload: OfflineSalePayload = {
    cashier_id: cashier.id,
    branch_id: till.branch_id, warehouse_id: till.warehouse_id, currency_code: 'BDT', exchange_rate: 1,
    business_date: new Date().toISOString(),
    items: cart.map(({ product, qty }) => ({ product_id: product.id, qty, unit_price: product.price })),
    payments: [{ payment_method: 'cash', amount: Number(total), financial_account_id: till.cash_account_id }],
  };
  // The hash covers the payload only (not the sale number), so it is worked out first.
  const payloadHash = await sha256Hex(JSON.stringify(payload));
  // The number is read, taken and the sale stored in one transaction, from the
  // stored till rather than the caller's copy: two sales never share a number,
  // even from two tabs.
  const db = await open();
  return new Promise<QueuedSale>((resolve, reject) => {
    const tx = db.transaction(['meta', 'sales'], 'readwrite');
    const meta = tx.objectStore('meta');
    let sale: QueuedSale | null = null;
    const read = meta.get('till') as IDBRequest<Till | undefined>;
    read.onsuccess = () => {
      const stored = read.result ?? till;
      const sequence = stored.next_sequence;
      sale = { sequence, idempotency_key: `offline-${stored.device_id}-${sequence}`, payload, payload_hash: payloadHash,
        lines, total, created_at: payload.business_date, status: 'queued', cashier_name: cashier.name };
      meta.put({ ...stored, next_sequence: sequence + 1 }, 'till');
      tx.objectStore('sales').add(sale);
    };
    tx.oncomplete = () => { db.close(); if (sale) resolve(sale); else reject(new Error('Sale not stored')); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export interface SendResult { sent: number; needsAttention: number; stoppedOffline: boolean; waitingForOthers: number }

/**
 * Send queued sales in order. `send` posts one sync request and returns the
 * HTTP status and body. A network failure or a server error stops the run (the
 * rest wait for the next try); a refusal marks that sale for a manager and
 * moves on.
 */
export async function sendQueued(till: Till, send: (body: string, key: string) => Promise<{ status: number; body: unknown }>, userId: string): Promise<SendResult> {
  const result: SendResult = { sent: 0, needsAttention: 0, stoppedOffline: false, waitingForOthers: 0 };
  for (const sale of await listSales()) {
    if (sale.status !== 'queued') continue;
    // Each cashier sends their own sales; another's wait for them (or a manager).
    if (sale.payload.cashier_id && sale.payload.cashier_id !== userId) { result.waitingForOthers++; continue; }
    let response: { status: number; body: unknown };
    try {
      response = await send(JSON.stringify({ device_id: till.device_id, commands: [{ command_type: 'cash_sale', sequence_number: sale.sequence,
        payload: sale.payload, payload_hash: sale.payload_hash, idempotency_key: sale.idempotency_key }] }), `sync-${sale.idempotency_key}-${sale.attempt ?? 0}`);
    } catch { result.stoppedOffline = true; break; }
    const body = response.body as { results?: Array<{ status: string }>; error?: { message?: string; code?: string } };
    const outcome = body.results?.[0]?.status;
    if (response.status < 300 && (outcome === 'applied' || outcome === 'duplicate')) { await deleteSale(sale.sequence); result.sent++; continue; }
    if (body.error?.code === 'OFFLINE_CASHIER_MISMATCH') { result.waitingForOthers++; continue; }
    if (response.status >= 500 || response.status === 401 || response.status === 429 || body.error?.code === 'CONCURRENT_MODIFICATION' || body.error?.code === 'OFFLINE') {
      result.stoppedOffline = true; break;
    }
    await putSale({ ...sale, status: 'needs_attention', error: body.error?.message ?? (outcome === 'conflict' ? 'This sale number was already used by a different sale' : `Refused (${response.status})`) });
    result.needsAttention++;
  }
  return result;
}

/**
 * A manager posts one sale whose cashier can no longer sign in. The server
 * checks approval.resolve, that the cashier really cannot sign in, and records
 * both people; the sale is credited to the manager.
 */
export async function postAsManager(till: Till, sequence: number, reason: string, send: (body: string, key: string) => Promise<{ status: number; body: unknown }>) {
  const sale = (await listSales()).find(s => s.sequence === sequence);
  if (!sale) return { ok: false as const, message: 'Sale not found on this till' };
  const response = await send(JSON.stringify({ device_id: till.device_id, adopt_reason: reason, commands: [{ command_type: 'cash_sale', sequence_number: sale.sequence,
    payload: sale.payload, payload_hash: sale.payload_hash, idempotency_key: sale.idempotency_key }] }), `adopt-${sale.idempotency_key}-${sale.attempt ?? 0}-${Date.now()}`);
  const body = response.body as { results?: Array<{ status: string }>; error?: { message?: string } };
  const outcome = body.results?.[0]?.status;
  if (response.status < 300 && (outcome === 'applied' || outcome === 'duplicate')) { await deleteSale(sale.sequence); return { ok: true as const }; }
  return { ok: false as const, message: body.error?.message ?? `Refused (${response.status})` };
}

/** Put a sale a manager has looked at back in the queue (e.g. after restocking). */
export async function retrySale(sequence: number) {
  const sale = (await listSales()).find(s => s.sequence === sequence);
  if (sale) await putSale({ ...sale, status: 'queued', error: undefined, attempt: (sale.attempt ?? 0) + 1 });
}
