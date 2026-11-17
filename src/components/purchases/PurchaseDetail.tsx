'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useDashboardSession } from '@/components/dashboard/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface PurchaseLine {
  id: string; product_name_snapshot: string; product_code_snapshot: string;
  qty_ordered: string; qty_received: string; unit_cost: string;
  product: { isSerialized: boolean; trackBatches: boolean };
}
interface Detail {
  reference_no: string; order_status: string; invoice_status: string; currency_code: string; grand_total: string;
  supplier: { name: string }; warehouse: { name: string }; branch: { name: string };
  items: PurchaseLine[];
  receivings: { id: string; reference_no: string; receiving_status: string; business_date: string; supplier_document_no: string | null; item_count: number }[];
}
interface DraftLine { qty: string; serials: string; batch: string; expiry: string; manufactured: string }
const emptyLine = (): DraftLine => ({ qty: '', serials: '', batch: '', expiry: '', manufactured: '' });

export function PurchaseDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const session = useDashboardSession();
  const canReceive = session?.is_global || session?.permissions.includes('purchase.receive');
  const canInvoice = session?.is_global || session?.permissions.includes('purchase.create');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [lines, setLines] = useState<Record<string, DraftLine>>({});
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [document, setDocument] = useState('');
  const [notes, setNotes] = useState('');
  const retry = useRef<{ payload: string; key: string } | null>(null);
  // Supplier invoice: moves what was received out of GRNI into the supplier's payable.
  const [invoicing, setInvoicing] = useState(false);
  const [invoice, setInvoice] = useState({ no: '', date: new Date().toISOString().slice(0, 10), amount: '', tax: '', taxId: '' });
  const [taxes, setTaxes] = useState<{ id: string; component_code: string; name?: string }[]>([]);
  const invoiceKey = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => {
    if (!invoicing || taxes.length) return;
    void apiFetch('/api/v1/tax-components').then(async r => { if (r.ok) setTaxes((await r.json()).items ?? []); });
  }, [invoicing, taxes.length]);
  async function postInvoice(event: React.FormEvent) {
    event.preventDefault();
    if (posting) return;
    const money = /^d{1,15}(.d{1,2})?$/;
    if (!invoice.no.trim()) { toast.error('Enter the supplier’s invoice number.'); return; }
    if (!money.test(invoice.amount) || Number(invoice.amount) <= 0) { toast.error('Enter the invoice total, like 64000 or 64000.50.'); return; }
    if (invoice.tax && (!money.test(invoice.tax) || Number(invoice.tax) > Number(invoice.amount))) { toast.error('VAT must be a valid amount no larger than the total.'); return; }
    if (invoice.tax && Number(invoice.tax) > 0 && !invoice.taxId) { toast.error('Choose which VAT the invoice charges.'); return; }
    if (!window.confirm(`Post supplier invoice ${invoice.no.trim()} for ${detail?.currency_code} ${invoice.amount}? It records what you owe the supplier.`)) return;
    const payload = JSON.stringify({ supplier_invoice_no: invoice.no.trim(), invoice_date: invoice.date, amount: invoice.amount,
      tax_amount: invoice.tax && Number(invoice.tax) > 0 ? invoice.tax : undefined, input_tax_component_id: invoice.tax && Number(invoice.tax) > 0 ? invoice.taxId : undefined });
    if (invoiceKey.current?.payload !== payload) invoiceKey.current = { payload, key: crypto.randomUUID() };
    setPosting(true); setError('');
    try {
      const response = await apiFetch(`/api/v1/purchases/${id}/invoice`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': invoiceKey.current.key }, body: payload });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? 'Unable to post the supplier invoice');
      const diff = Number(data.price_variance);
      toast.success(diff === 0 ? 'Supplier invoice posted.' : `Supplier invoice posted. Price difference of ${Math.abs(diff).toFixed(2)} ${diff > 0 ? 'above' : 'below'} the received value went to purchase variance.`);
      invoiceKey.current = null; setInvoicing(false);
      await load(); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to post the supplier invoice. Try again; it will not be posted twice.'); }
    finally { setPosting(false); }
  }
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await apiFetch(`/api/v1/purchases/${id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? 'Unable to load purchase');
      setDetail(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load purchase'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  function update(lineId: string, field: keyof DraftLine, value: string) {
    setLines(current => ({ ...current, [lineId]: { ...(current[lineId] ?? emptyLine()), [field]: value } }));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || posting) return;
    const items = detail.items.flatMap(item => {
      const draft = lines[item.id];
      if (!draft || !Number(draft.qty)) return [];
      return [{ purchase_item_id: item.id, qty_received_now: Number(draft.qty),
        serials: draft.serials.split(/[\n,]+/).map(s => s.trim()).filter(Boolean),
        batch_no: draft.batch || undefined,
        expiry_date: draft.expiry ? new Date(draft.expiry).toISOString() : undefined,
        manufactured_at: draft.manufactured ? new Date(draft.manufactured).toISOString() : undefined }];
    });
    if (!items.length) { toast.error('Enter at least one receiving quantity.'); return; }
    for (const row of items) {
      const source = detail.items.find(item => item.id === row.purchase_item_id)!;
      if (row.qty_received_now <= 0 || row.qty_received_now > Number(source.qty_ordered) - Number(source.qty_received)) {
        toast.error(`Check remaining quantity for ${source.product_name_snapshot}.`); return;
      }
      if (source.product.isSerialized && (row.serials.length !== row.qty_received_now || new Set(row.serials).size !== row.serials.length)) {
        toast.error(`Enter one unique serial per received unit of ${source.product_name_snapshot}.`); return;
      }
    }
    if (!window.confirm('Post this receiving? Stock and accounting will be updated.')) return;
    const payload = JSON.stringify({ business_date: new Date(date).toISOString(), supplier_document_no: document || undefined, notes: notes || undefined, items });
    if (retry.current?.payload !== payload) retry.current = { payload, key: crypto.randomUUID() };
    setPosting(true); setError('');
    try {
      const response = await apiFetch(`/api/v1/purchases/${id}/receivings`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': retry.current.key }, body: payload });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? 'Unable to post receiving');
      toast.success(`${data.reference_no} posted — ${data.purchase_new_status.replaceAll('_', ' ')}`);
      retry.current = null; setLines({}); setReceiving(false); setDocument(''); setNotes('');
      await load(); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to post receiving. Retry with the same quantities.'); }
    finally { setPosting(false); }
  }
  const remaining = detail?.items.filter(item => Number(item.qty_ordered) > Number(item.qty_received)) ?? [];
  return <Card>
    <CardHeader className="gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>{detail?.reference_no ?? 'Purchase details'}</CardTitle><Button variant="outline" disabled={posting} onClick={() => { if (!receiving || window.confirm('Discard this receiving draft?')) onClose(); }}>Close details</Button></div></CardHeader>
    <CardContent className="space-y-5">
      {loading ? <p role="status">Loading purchase…</p> : null}
      {error ? <div role="alert" className="space-y-2"><p>{error}</p><Button type="button" variant="outline" disabled={posting} onClick={() => void load()}>Refresh details</Button></div> : null}
      {detail ? <>
        <div className="flex flex-wrap gap-4 text-sm"><Badge>{detail.order_status.replaceAll('_', ' ')}</Badge><span>Supplier: {detail.supplier.name}</span><span>{detail.branch.name} / {detail.warehouse.name}</span><strong>{detail.currency_code} {Number(detail.grand_total).toFixed(2)}</strong></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Purchase quantities</caption><thead><tr className="border-b text-left"><th className="py-2">Product</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Unit cost</th></tr></thead><tbody>{detail.items.map(item => <tr key={item.id} className="border-b"><td className="py-3 pr-3">{item.product_name_snapshot}<span className="block text-xs text-muted-foreground">{item.product_code_snapshot}</span></td><td>{item.qty_ordered}</td><td>{item.qty_received}</td><td>{Number(item.qty_ordered) - Number(item.qty_received)}</td><td>{item.unit_cost}</td></tr>)}</tbody></table></div>
        {canReceive && remaining.length > 0 && !['closed', 'cancelled'].includes(detail.order_status) && !receiving ? <Button onClick={() => setReceiving(true)}>Receive stock</Button> : null}
        {receiving ? <form onSubmit={submit} className="space-y-4 rounded-md border p-4"><h3 className="font-semibold">Receive stock</h3><fieldset disabled={posting} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="receiving-date">Business date</Label><Input id="receiving-date" type="date" required value={date} onChange={e => setDate(e.target.value)} /></div><div><Label htmlFor="receiving-document">Supplier document</Label><Input id="receiving-document" maxLength={100} value={document} onChange={e => setDocument(e.target.value)} /></div></div>
          {remaining.map(item => { const draft = lines[item.id] ?? emptyLine(); return <div key={item.id} className="space-y-3 rounded-md border p-3"><p className="font-medium">{item.product_name_snapshot}</p><Label htmlFor={`receive-${item.id}`}>Receive now (remaining {Number(item.qty_ordered) - Number(item.qty_received)})</Label><Input id={`receive-${item.id}`} type="number" min="0" max={Number(item.qty_ordered) - Number(item.qty_received)} step={item.product.isSerialized ? '1' : '0.0001'} value={draft.qty} onChange={e => update(item.id, 'qty', e.target.value)} />
            {item.product.isSerialized ? <div><Label htmlFor={`serials-${item.id}`}>Serial numbers (one per line)</Label><Textarea id={`serials-${item.id}`} value={draft.serials} onChange={e => update(item.id, 'serials', e.target.value)} /></div> : null}
            {item.product.trackBatches ? <div className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor={`batch-${item.id}`}>Batch number</Label><Input id={`batch-${item.id}`} value={draft.batch} onChange={e => update(item.id, 'batch', e.target.value)} /></div><div><Label htmlFor={`manufactured-${item.id}`}>Manufactured</Label><Input id={`manufactured-${item.id}`} type="date" value={draft.manufactured} onChange={e => update(item.id, 'manufactured', e.target.value)} /></div><div><Label htmlFor={`expiry-${item.id}`}>Expiry</Label><Input id={`expiry-${item.id}`} type="date" value={draft.expiry} onChange={e => update(item.id, 'expiry', e.target.value)} /></div></div> : null}
          </div>; })}
          <div><Label htmlFor="receiving-notes">Notes</Label><Textarea id="receiving-notes" value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <div className="flex flex-wrap gap-2"><Button type="submit">{posting ? 'Posting…' : 'Post receiving'}</Button><Button type="button" variant="outline" onClick={() => { if (window.confirm('Discard this receiving draft?')) { setReceiving(false); setLines({}); } }}>Cancel receiving</Button></div>
        </fieldset></form> : null}
        {detail.invoice_status === 'invoiced'
          ? <p className="text-sm"><Badge variant="secondary">Supplier invoice posted</Badge></p>
          : canInvoice && detail.receivings.length > 0 && !invoicing
            ? <Button variant="outline" onClick={() => setInvoicing(true)}>Post supplier invoice</Button>
            : null}
        {invoicing ? <form onSubmit={postInvoice} className="space-y-4 rounded-md border p-4"><h3 className="font-semibold">Supplier invoice</h3>
          <p className="text-sm text-muted-foreground">Records what you owe the supplier for the stock received. Post it once, when the bill arrives.</p>
          <fieldset disabled={posting} className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="invoice-no">Supplier invoice number</Label><Input id="invoice-no" required maxLength={100} value={invoice.no} onChange={e => setInvoice(v => ({ ...v, no: e.target.value }))} /></div>
            <div><Label htmlFor="invoice-date">Invoice date</Label><Input id="invoice-date" type="date" required value={invoice.date} onChange={e => setInvoice(v => ({ ...v, date: e.target.value }))} /></div>
            <div><Label htmlFor="invoice-amount">Invoice total ({detail.currency_code}, including VAT)</Label><Input id="invoice-amount" inputMode="decimal" required value={invoice.amount} onChange={e => setInvoice(v => ({ ...v, amount: e.target.value.trim() }))} /></div>
            <div><Label htmlFor="invoice-tax">VAT on the invoice (optional)</Label><Input id="invoice-tax" inputMode="decimal" value={invoice.tax} onChange={e => setInvoice(v => ({ ...v, tax: e.target.value.trim() }))} /></div>
            {invoice.tax && Number(invoice.tax) > 0 ? <div className="sm:col-span-2"><Label htmlFor="invoice-tax-type">Which VAT</Label>
              <select id="invoice-tax-type" className="h-10 w-full rounded-md border bg-background px-2" value={invoice.taxId} onChange={e => setInvoice(v => ({ ...v, taxId: e.target.value }))}>
                <option value="">Choose…</option>{taxes.map(t => <option key={t.id} value={t.id}>{t.name ?? t.component_code}</option>)}
              </select></div> : null}
            <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit">{posting ? 'Posting…' : 'Post invoice'}</Button><Button type="button" variant="outline" onClick={() => setInvoicing(false)}>Cancel</Button></div>
          </fieldset></form> : null}
        <h3 className="font-semibold">Receiving history</h3>{detail.receivings.length ? <ul className="divide-y">{detail.receivings.map(receipt => <li key={receipt.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span className="font-medium">{receipt.reference_no}</span><span>{new Date(receipt.business_date).toLocaleDateString()}</span><span>{receipt.item_count} lines</span><span>{receipt.supplier_document_no}</span><Badge variant="secondary">{receipt.receiving_status}</Badge></li>)}</ul> : <p className="text-sm text-muted-foreground">No stock received yet.</p>}
      </> : null}
    </CardContent>
  </Card>;
}
