'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useDashboardSession } from '@/components/dashboard/session';
import { useWorkflowMutation } from '@/hooks/useWorkflowMutation';
import { EntityPicker, type BusinessEntity } from '@/components/shared/EntityPicker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface Sale {
  id: string; reference_no: string; sale_status: string; grand_total: string; currency_code: string; exchange_rate: string;
  subtotal: string; discount_total: string; tax_total: string;
  branch: BusinessEntity; warehouse: BusinessEntity; customer: BusinessEntity | null;
  // Sale-time snapshots: what was charged then, not today's price.
  items: { id: string; product_name_snapshot: string; qty: string; qty_returned: number; line_total: string;
    unit_price_snapshot: string; gross_amount: string; discount_amount: string; tax_amount: string;
    product: { isSerialized: boolean }; returnable_serials: string[] }[];
  payments: { id: string; allocated_amount: string; payment: { referenceNo: string; paymentMethod: string; paymentStatus: string } }[];
}
const money = (v: string) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Discount as a share of the pre-discount amount, exact in paisa, half-up to 2 places; display only. */
function pct(discount: string, gross: string): string {
  const paisa = (v: string) => { const [w, d = ''] = Number(v).toFixed(2).split('.'); return BigInt(w) * BigInt(100) + BigInt(d); };
  const part = paisa(discount), whole = paisa(gross);
  if (whole <= BigInt(0)) return '';
  const scaled = (part * BigInt(20000) + whole) / (whole * BigInt(2));
  return `${scaled / BigInt(100)}.${String(scaled % BigInt(100)).padStart(2, '0')}`.replace(/\.?0+$/, '') + '%';
}
interface Return { id: string; reference_no: string; total_credit: string; refunded_amount: string; balance_due: string; refund_status: string }
interface ReturnLine { qty: string; condition: string; serials: string[] }
export function SaleDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const session = useDashboardSession();
  const can = (code: string) => !!(session?.is_global || session?.permissions.includes(code));
  const [sale, setSale] = useState<Sale | null>(null);
  const [returns, setReturns] = useState<Return[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [returning, setReturning] = useState(false); const [reason, setReason] = useState('');
  const [lines, setLines] = useState<Record<string, ReturnLine>>({});
  const [refund, setRefund] = useState<Return | null>(null); const [amount, setAmount] = useState('');
  const [account, setAccount] = useState<BusinessEntity | null>(null); const [method, setMethod] = useState('cash');
  const command = useWorkflowMutation();
  // Set when the server refuses a return or refund for needing a manager's
  // approval (src/lib/approval/refundGate.ts). Later attempts carry the
  // approval id; the server decides whether it is approved yet.
  const [largeRefund, setLargeRefund] = useState<{ total: string; threshold: number; approvalId?: string } | null>(null);
  const { errorInfo, setError: setCommandError } = command;
  useEffect(() => {
    const details = errorInfo?.details;
    if (errorInfo?.code !== 'APPROVAL_REQUIRED' || !details) return;
    if (details.reference_id === id) {
      const total = String(details.amount_base);
      // A new amount, or an approval that covers less, needs a new request.
      setLargeRefund(current => ({ total, threshold: Number(details.threshold),
        approvalId: current?.total === total && details.approved_total === undefined ? current.approvalId : undefined }));
    } else if (typeof details.approval_request_id === 'string') {
      // A request for this sale is already waiting: use it.
      const approvalId = details.approval_request_id;
      setLargeRefund(current => current ? { ...current, approvalId } : current);
      setCommandError('');
    }
  }, [errorInfo, id, setCommandError]);
  const approvalField = largeRefund?.approvalId ? { approval_request_id: largeRefund.approvalId } : {};
  const awaitingApproval = !!largeRefund?.approvalId && errorInfo?.code === 'APPROVAL_REQUIRED';
  async function askApproval() {
    if (!sale || !largeRefund) return;
    const result = await command.mutate<{ item: { id: string } }>('/api/v1/approvals', { request_type: 'large_refund', reference_type: 'sale', reference_id: id, branch_id: sale.branch.id,
      payload: { refund_total: largeRefund.total, sale_reference_no: sale.reference_no, customer: sale.customer?.name ?? 'Walk-in customer' } });
    if (result) { setLargeRefund({ ...largeRefund, approvalId: result.item.id }); toast.success('Approval requested. When a manager approves it, try again.'); }
  }
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [response, refundResponse] = await Promise.all([apiFetch(`/api/v1/sales/${id}`), apiFetch(`/api/v1/refunds?sale_id=${id}&limit=200`)]);
      const [data, refunds] = await Promise.all([response.json(), refundResponse.json()]);
      if (!response.ok || !refundResponse.ok) throw new Error(data.error?.message ?? refunds.error?.message ?? 'Unable to load sale');
      setSale(data); setReturns(refunds.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load sale'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  function update(lineId: string, patch: Partial<ReturnLine>) {
    setLines(current => ({ ...current, [lineId]: { ...(current[lineId] ?? { qty: '', condition: 'resalable', serials: [] }), ...patch } }));
  }
  async function postReturn(event: React.FormEvent) {
    event.preventDefault(); if (!sale) return;
    const items = sale.items.flatMap(item => Number(lines[item.id]?.qty) > 0 ? [{ sale_item_id: item.id, qty_returned: Number(lines[item.id].qty), condition: lines[item.id].condition, serials: lines[item.id].serials }] : []);
    if (!items.length || !reason.trim()) { command.setError('Enter a reason and at least one returned quantity.'); return; }
    for (const item of items) {
      const original = sale.items.find(row => row.id === item.sale_item_id)!;
      if (item.qty_returned > Number(original.qty) - original.qty_returned || (original.product.isSerialized && item.serials.length !== item.qty_returned)) { command.setError('Check returnable quantities and selected serials.'); return; }
    }
    if (!window.confirm('Post return credit and update inventory? Refund is a separate confirmed action.')) return;
    const conditions = [...new Set(items.map(item => item.condition))];
    const result = await command.mutate('/api/v1/sale-returns', { sale_id: id, branch_id: sale.branch.id, warehouse_id: sale.warehouse.id,
      disposition: conditions.length > 1 ? 'mixed' : conditions[0] === 'resalable' ? 'restock' : 'damaged', reason: reason.trim(), items, ...approvalField });
    if (result) { toast.success('Return posted. Review refund balance below.'); setLargeRefund(null); setReturning(false); setLines({}); setReason(''); await load(); onChanged(); }
  }
  async function postRefund(event: React.FormEvent) {
    event.preventDefault(); if (!sale || !refund || !account) { command.setError('Select a refund account.'); return; }
    if (Number(amount) <= 0 || Number(amount) > Number(refund.balance_due)) { command.setError('Enter an amount within the remaining return credit.'); return; }
    if (!window.confirm(`Record an outgoing ${method.replaceAll('_', ' ')} refund of ${sale.currency_code} ${amount}? Confirm the customer receives this payment.`)) return;
    const result = await command.mutate('/api/v1/payments', { branch_id: sale.branch.id, financial_account_id: account.id, payment_type: 'sale_refund', direction: 'outgoing', customer_id: sale.customer?.id,
      sale_return_id: refund.id, currency_code: sale.currency_code, exchange_rate: Number(sale.exchange_rate), amount: Number(amount), payment_method: method, ...approvalField });
    if (result) { toast.success('Refund recorded.'); setLargeRefund(null); setRefund(null); setAmount(''); await load(); onChanged(); }
  }
  return <Card><CardHeader><div className="flex flex-wrap justify-between gap-3"><CardTitle><h2>{sale?.reference_no ?? 'Sale details'}</h2></CardTitle><Button variant="outline" disabled={command.pending} onClick={() => { if ((!returning && !refund) || window.confirm('Discard the current draft?')) onClose(); }}>Close details</Button></div></CardHeader><CardContent className="space-y-4">
    {loading ? <p role="status">Loading sale…</p> : null}{error || (command.error && !(largeRefund && errorInfo?.code === 'APPROVAL_REQUIRED')) ? <div role="alert" className="space-y-2"><p>{error || command.error}</p>{error ? <Button variant="outline" onClick={() => void load()}>Retry sale details</Button> : null}</div> : null}
    {sale ? <><div className="flex flex-wrap gap-3"><Badge>{sale.sale_status.replaceAll('_', ' ')}</Badge><span>{sale.customer?.name ?? 'Walk-in customer'}</span><span>{sale.branch.name} / {sale.warehouse.name}</span><strong>{sale.currency_code} {Number(sale.grand_total).toFixed(2)}</strong></div>
      {can('sale.read') ? <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><a href={`/print/invoice/${id}`} target="_blank" rel="noopener noreferrer">Invoice / print</a></Button><Button asChild variant="outline"><a href={`/print/receipt/${id}`} target="_blank" rel="noopener noreferrer">Receipt / print</a></Button></div> : null}
      <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Items sold, at the prices and discounts of the sale</caption><thead><tr className="border-b text-left"><th>Product</th><th className="text-right">Unit price</th><th className="text-right">Sold</th><th className="text-right">Returned</th><th className="text-right">Before discount</th><th className="text-right">Discount</th><th className="text-right">VAT</th><th className="text-right">Line total</th></tr></thead>
        <tbody className="tabular-nums">{sale.items.map(item => <tr className="border-b" key={item.id}><td className="py-3 pr-3">{item.product_name_snapshot}</td><td className="text-right">{money(item.unit_price_snapshot)}</td><td className="text-right">{item.qty}</td><td className="text-right">{item.qty_returned}</td><td className="text-right">{money(item.gross_amount)}</td>
          <td className="text-right">{Number(item.discount_amount) > 0 ? <>{money(item.discount_amount)} <span className="text-xs text-muted-foreground">({pct(item.discount_amount, item.gross_amount)})</span></> : '—'}</td><td className="text-right">{money(item.tax_amount)}</td><td className="text-right font-medium">{money(item.line_total)}</td></tr>)}</tbody>
        <tfoot className="tabular-nums"><tr><td className="pt-2" colSpan={4}>Subtotal</td><td className="pt-2 text-right">{money(sale.subtotal)}</td><td className="pt-2 text-right">{Number(sale.discount_total) > 0 ? <>{money(sale.discount_total)} <span className="text-xs text-muted-foreground">({pct(sale.discount_total, sale.subtotal)})</span></> : '—'}</td><td className="pt-2 text-right">{money(sale.tax_total)}</td><td className="pt-2 text-right font-semibold">{money(sale.grand_total)}</td></tr></tfoot></table></div>
      <section><h3 className="font-semibold">Payments</h3>{sale.payments.length ? <ul className="divide-y">{sale.payments.map(payment => <li key={payment.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>{payment.payment.referenceNo}</span><span>{payment.payment.paymentMethod}</span><span>{payment.allocated_amount}</span><Badge variant="secondary">{payment.payment.paymentStatus}</Badge></li>)}</ul> : <p>No payments allocated.</p>}</section>
      {largeRefund ? <div role="status" aria-live="polite" className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-4">
        <p className="font-medium">A manager needs to approve this</p>
        <p className="text-sm">Returns and refunds on this sale would total {sale.currency_code} {money(largeRefund.total)}. From {sale.currency_code} {money(String(largeRefund.threshold))} on one sale, a manager must approve first.</p>
        {largeRefund.approvalId ? <p className="text-sm">{awaitingApproval ? 'Not approved yet. ' : 'Approval requested. '}When a manager approves it under Approvals, press {refund ? 'Confirm refund' : 'Post return'} again.</p>
          : can('approval.request') && can('approval.read') ? <Button type="button" disabled={command.pending} onClick={() => void askApproval()}>Ask a manager to approve</Button>
          : <p className="text-sm">Ask a manager to request and approve it.</p>}
      </div> : null}
      {can('sale_return.post') && ['completed', 'partially_returned'].includes(sale.sale_status) && !returning ? <Button onClick={() => setReturning(true)}>Return items</Button> : null}
      {returning ? <form onSubmit={postReturn}><fieldset disabled={command.pending} className="space-y-4 rounded-md border p-4"><h3 className="font-semibold">Return items</h3><div><Label htmlFor="return-reason">Return reason</Label><Textarea id="return-reason" required maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></div>
        {sale.items.filter(item => Number(item.qty) > item.qty_returned).map(item => <div key={item.id} className="space-y-2 rounded-md border p-3"><p className="font-medium">{item.product_name_snapshot}</p><Label htmlFor={`return-qty-${item.id}`}>Return quantity (available {Number(item.qty) - item.qty_returned})</Label><Input id={`return-qty-${item.id}`} type="number" min="0" max={Number(item.qty) - item.qty_returned} step={item.product.isSerialized ? '1' : '0.0001'} value={lines[item.id]?.qty ?? ''} onChange={e => update(item.id, { qty: e.target.value })} /><Label htmlFor={`return-condition-${item.id}`}>Condition</Label><select id={`return-condition-${item.id}`} className="h-11 w-full rounded-md border bg-background px-2" value={lines[item.id]?.condition ?? 'resalable'} onChange={e => update(item.id, { condition: e.target.value })}><option value="resalable">Resalable — restock</option><option value="damaged">Damaged — quarantine</option></select>
          {item.product.isSerialized ? <fieldset className="space-y-2"><legend>Select returned serials</legend>{item.returnable_serials.map(serial => <Label className="flex items-center gap-2 py-2" key={serial}><input type="checkbox" checked={lines[item.id]?.serials.includes(serial) ?? false} onChange={e => update(item.id, { serials: e.target.checked ? [...(lines[item.id]?.serials ?? []), serial] : (lines[item.id]?.serials ?? []).filter(value => value !== serial) })} />{serial}</Label>)}</fieldset> : null}
        </div>)}<div className="flex gap-2"><Button type="submit">Post return</Button><Button type="button" variant="outline" onClick={() => { if (window.confirm('Discard return draft?')) { setReturning(false); setLargeRefund(null); } }}>Cancel return</Button></div>
      </fieldset></form> : null}
      <section className="space-y-3"><h3 className="font-semibold">Returns and refunds</h3>{returns.length ? returns.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div><p className="font-medium">{item.reference_no}</p><p className="text-sm">Credit {item.total_credit} · Refunded {item.refunded_amount} · Remaining {item.balance_due}</p></div><Badge variant="secondary">{item.refund_status.replaceAll('_', ' ')}</Badge>{can('sale.refund.branch') && can('payment.pay.branch') && Number(item.balance_due) > 0 ? <Button variant="outline" disabled={command.pending} onClick={() => { setRefund(item); setAmount(item.balance_due); }}>Record refund</Button> : null}</div>) : <p className="text-sm text-muted-foreground">No returns recorded.</p>}</section>
      {refund ? <form onSubmit={postRefund}><fieldset disabled={command.pending} className="space-y-3 rounded-md border p-4"><h3 className="font-semibold">Refund {refund.reference_no}</h3><p className="text-sm text-muted-foreground">Records a payment already handed to the customer. Card/mobile gateway refunds must be completed with the provider first.</p><EntityPicker label="Refund account" endpoint={`/api/v1/financial-accounts?is_active=true&branch_id=${sale.branch.id}`} serverSearch={false} value={account} onChange={setAccount} /><Label htmlFor="refund-method">Refund method</Label><select id="refund-method" className="h-11 w-full rounded-md border bg-background px-2" value={method} onChange={e => setMethod(e.target.value)}>{['cash', 'card', 'bkash', 'nagad', 'bank_transfer'].map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select><Label htmlFor="refund-amount">Refund amount</Label><Input id="refund-amount" required type="number" min="0.01" max={refund.balance_due} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /><div className="flex gap-2"><Button type="submit">Confirm refund</Button><Button type="button" variant="outline" onClick={() => { setRefund(null); setLargeRefund(null); }}>Cancel refund</Button></div></fieldset></form> : null}
    </> : null}
  </CardContent></Card>;
}
