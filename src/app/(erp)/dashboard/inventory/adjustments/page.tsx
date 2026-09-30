'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useDashboardSession } from '@/components/dashboard/session';
import { useWorkflowMutation } from '@/hooks/useWorkflowMutation';
import { useDraftProtection } from '@/hooks/useDraftProtection';
import { EntityPicker, type BusinessEntity } from '@/components/shared/EntityPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

type Product = BusinessEntity & { is_serialized?: boolean; track_batches?: boolean };
type Line = { key: string; product: Product | null; qty: string; cost: string; serials: string; batch: string };
type Adjustment = { id: string; reference_no: string; status: string; adjustment_type: string; warehouse: BusinessEntity; business_date: string; posted_at?: string; notes?: string; reason?: BusinessEntity; journal_entry_id?: string; approval?: { id: string; status: string; requestedBy: string; reason: string } | null; items?: { id: string; product: BusinessEntity; quantity: string; unit_cost: string; value: string; batch?: string; serials: { number: string; status: string }[] }[] };
const emptyLine = (): Line => ({ key: crypto.randomUUID(), product: null, qty: '', cost: '', serials: '', batch: '' });
const kinds: Record<string, string> = { add: 'Add stock', subtract: 'Remove stock', damage: 'Move to damaged stock', writeoff: 'Write off stock', reclassify: 'Recover damaged stock', correction: 'Quantity correction' };
export default function AdjustmentsPage() {
  const session = useDashboardSession(); const can = (permission: string) => !!(session?.is_global || session?.permissions.includes(permission));
  const command = useWorkflowMutation();
  const [rows, setRows] = useState<Adjustment[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [detail, setDetail] = useState<Adjustment | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const [creating, setCreating] = useState(false);
  const [warehouse, setWarehouse] = useState<BusinessEntity | null>(null); const [reason, setReason] = useState<(BusinessEntity & { requiresApproval?: boolean }) | null>(null);
  const [kind, setKind] = useState('add'); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ key: 'initial', product: null, qty: '', cost: '', serials: '', batch: '' }]);
  const dirty = creating && !!(warehouse || reason || notes || lines.some(line => line.product || line.qty)); useDraftProtection(dirty);
  const load = useCallback(async (next?: string) => {
    setLoading(true); setError('');
    try { const res = await apiFetch(`/api/v1/stock-adjustments?limit=50${next ? `&cursor=${encodeURIComponent(next)}` : ''}`); const data = await res.json(); if (!res.ok) throw new Error(data.error?.message ?? 'Unable to load adjustments'); setRows(current => next ? [...current, ...data.items] : data.items); setCursor(data.has_more ? data.next_cursor : null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load adjustments'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function view(id: string) {
    setLoading(true); setError('');
    try { const res = await apiFetch(`/api/v1/stock-adjustments/${id}`); const data = await res.json(); if (!res.ok) throw new Error(data.error?.message ?? 'Unable to load adjustment'); setDetail(data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load adjustment'); } finally { setLoading(false); }
  }
  function update(key: string, patch: Partial<Line>) { setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line)); }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!warehouse?.branch || !reason || !notes.trim() || lines.some(line => !line.product || !Number.isFinite(Number(line.qty)) || Number(line.qty) === 0 || kind !== 'correction' && Number(line.qty) < 0)) { command.setError('Select warehouse, reason and products; enter nonzero quantities and an explanation.'); return; }
    const items = lines.map(line => ({ product_id: line.product!.id, quantity_delta: ['subtract', 'damage', 'writeoff'].includes(kind) ? -Number(line.qty) : Number(line.qty), unit_cost: line.cost === '' ? undefined : Number(line.cost), serial_numbers: line.product?.is_serialized ? line.serials.split(/[\s,]+/).filter(Boolean) : undefined, batch_no: line.product?.track_batches ? line.batch.trim() || undefined : undefined }));
    if (items.some(item => item.quantity_delta > 0 && kind !== 'reclassify' && item.unit_cost === undefined)) { command.setError('Enter a unit cost for each added quantity.'); return; }
    if (!window.confirm(reason.requiresApproval ? 'Submit this adjustment for independent approval? No stock will move yet.' : 'Post this adjustment to stock and accounting? Removed serials will be marked scrapped; damaged units remain in the damaged bucket.')) return;
    const result = await command.mutate<{ adjustmentId: string; status: string }>('/api/v1/stock-adjustments', { branch_id: warehouse.branch.id, warehouse_id: warehouse.id, reason_code_id: reason.id, adjustment_type: kind, business_date: new Date(`${date}T00:00:00`).toISOString(), notes: notes.trim(), items });
    if (result) { setCreating(false); setLines([emptyLine()]); setNotes(''); toast.success(result.status === 'posted' ? 'Adjustment posted.' : 'Adjustment submitted for approval.'); await load(); await view(result.adjustmentId); }
  }
  async function action(action: 'post' | 'cancel') {
    if (!detail || !window.confirm(action === 'post' ? 'Post the approved adjustment to inventory and accounting?' : 'Cancel this pending adjustment and its approval request?')) return;
    const result = await command.mutate(`/api/v1/stock-adjustments/${detail.id}`, { action }); if (result) { toast.success('Adjustment updated.'); await load(); await view(detail.id); }
  }
  async function resolve(decision: 'approved' | 'rejected') {
    if (!detail?.approval || !window.confirm(`${decision === 'approved' ? 'Approve' : 'Reject'} this adjustment?`)) return;
    const result = await command.mutate(`/api/v1/approvals/${detail.approval.id}/resolve`, { decision, reason: `Reviewed adjustment ${detail.reference_no}` }); if (result) { toast.success('Approval updated.'); await view(detail.id); }
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold">Stock adjustments</h1><p className="text-muted-foreground">Record explained changes with stock and accounting history.</p></div><div className="flex gap-2"><Button variant="outline" disabled={loading || command.pending} onClick={() => void load()}>Refresh</Button>{can('stock_adjustment.post') ? <Button disabled={creating || command.pending} onClick={() => setCreating(true)}>New adjustment</Button> : null}</div></div>
    {error || command.error ? <div role="alert" className="rounded-md border p-4">{error || command.error}{error ? <Button variant="outline" onClick={() => detail ? void view(detail.id) : void load()}>Retry</Button> : null}</div> : null}
    {loading ? <p role="status">Loading adjustments…</p> : null}
    {creating ? <Card><CardHeader><CardTitle>New adjustment</CardTitle></CardHeader><CardContent><form onSubmit={create}><fieldset disabled={command.pending} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2"><EntityPicker label="Adjustment warehouse" endpoint="/api/v1/warehouses" serverSearch={false} value={warehouse} onChange={setWarehouse} /><EntityPicker label="Adjustment reason" endpoint="/api/v1/inventory-reasons" value={reason} onChange={setReason} /><div><Label htmlFor="adjustment-kind">Adjustment type</Label><select id="adjustment-kind" className="h-11 w-full rounded-md border bg-background px-3" value={kind} onChange={event => setKind(event.target.value)}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div><Label htmlFor="adjustment-date">Business date</Label><Input id="adjustment-date" type="date" required value={date} onChange={event => setDate(event.target.value)} /></div></div>
      {reason?.requiresApproval ? <p className="rounded-md border p-3">This reason requires independent approval before posting.</p> : null}
      {lines.map((line, index) => <section key={line.key} className="space-y-3 rounded-md border p-4"><div className="grid items-end gap-3 sm:grid-cols-[1fr_8rem_9rem]"><EntityPicker label={`Adjustment product ${index + 1}`} endpoint="/api/v1/products?is_active=true" value={line.product} onChange={product => update(line.key, { product, serials: '', batch: '' })} /><div><Label htmlFor={`qty-${line.key}`}>Quantity {index + 1}</Label><Input id={`qty-${line.key}`} required type="number" step={line.product?.is_serialized ? '1' : '0.0001'} min={kind === 'correction' ? undefined : line.product?.is_serialized ? '1' : '0.0001'} value={line.qty} onChange={event => update(line.key, { qty: event.target.value })} /></div><div><Label htmlFor={`cost-${line.key}`}>Unit cost {index + 1}</Label><Input id={`cost-${line.key}`} type="number" min="0" step="0.0001" disabled={!['add', 'correction'].includes(kind)} value={line.cost} onChange={event => update(line.key, { cost: event.target.value })} placeholder="Added stock only" /></div></div>
        {line.product?.is_serialized ? <div><Label htmlFor={`serials-${line.key}`}>Adjustment serials {index + 1}</Label><Textarea id={`serials-${line.key}`} required value={line.serials} onChange={event => update(line.key, { serials: event.target.value })} placeholder="One serial per unit, one per line" /></div> : null}
        {line.product?.track_batches ? <div><Label htmlFor={`batch-${line.key}`}>Batch number {index + 1}</Label><Input id={`batch-${line.key}`} required value={line.batch} onChange={event => update(line.key, { batch: event.target.value })} /></div> : null}
        <Button type="button" variant="outline" disabled={lines.length === 1} aria-label={`Remove adjustment line ${index + 1}`} onClick={() => setLines(current => current.filter(item => item.key !== line.key))}>Remove line</Button>
      </section>)}
      <Button type="button" variant="outline" onClick={() => setLines(current => [...current, emptyLine()])}>Add line</Button>
      <p className="text-sm text-muted-foreground">Enter positive quantities for add/remove/damage/write-off. Corrections accept signed quantities. Removed stock uses its current average cost; recovery moves damaged units back to available stock.</p>
      <div><Label htmlFor="adjustment-notes">Explanation</Label><Textarea id="adjustment-notes" required value={notes} onChange={event => setNotes(event.target.value)} /></div>
      <div className="flex gap-2"><Button type="submit">{command.pending ? 'Submitting…' : reason?.requiresApproval ? 'Submit for approval' : 'Post adjustment'}</Button><Button type="button" variant="outline" onClick={() => { if (!dirty || window.confirm('Discard this adjustment draft?')) setCreating(false); }}>Cancel</Button></div>
    </fieldset></form></CardContent></Card> : null}
    {detail ? <Card><CardHeader className="flex flex-wrap flex-row justify-between gap-3"><CardTitle><h2>{detail.reference_no}</h2></CardTitle><div className="flex gap-2"><Button variant="outline" disabled={loading || command.pending} onClick={() => void view(detail.id)}>Refresh details</Button><Button variant="outline" disabled={command.pending} onClick={() => setDetail(null)}>Close details</Button></div></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap items-center gap-3"><Badge>{detail.status.replaceAll('_', ' ')}</Badge><span>{kinds[detail.adjustment_type] ?? detail.adjustment_type} · {detail.warehouse.name}</span></div>
      <p>Business date: {new Date(detail.business_date).toLocaleDateString()} · Reason: {detail.reason?.name}</p><p className="whitespace-pre-wrap">{detail.notes}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">Product</th><th>Quantity change</th><th>Unit cost</th><th>Value change</th></tr></thead><tbody>{detail.items?.map(item => <tr key={item.id} className="border-b"><td className="py-3 pr-4">{item.product.name}{item.batch ? <p>Batch: {item.batch}</p> : null}{item.serials.map(serial => <p key={serial.number} className="text-xs">{serial.number} · {serial.status}</p>)}</td><td>{item.quantity}</td><td>{item.unit_cost}</td><td>{item.value}</td></tr>)}</tbody></table></div>
      {detail.status === 'pending_approval' ? <p className="text-sm text-muted-foreground">Stock has not moved. Outbound cost is recalculated at posting.</p> : null}
      {detail.journal_entry_id ? <p>Accounting journal posted with this adjustment.</p> : null}
      {detail.approval ? <div className="space-y-2"><p>Approval: <Badge variant="secondary">{detail.approval.status}</Badge></p>{detail.approval.status === 'pending' && can('approval.resolve') && detail.approval.requestedBy !== session?.id ? <div className="flex gap-2"><Button disabled={command.pending} onClick={() => void resolve('approved')}>Approve adjustment</Button><Button variant="outline" disabled={command.pending} onClick={() => void resolve('rejected')}>Reject adjustment</Button></div> : null}</div> : null}
      {detail.status === 'pending_approval' && can('stock_adjustment.post') ? <div className="flex gap-2"><Button disabled={command.pending || detail.approval?.status !== 'approved'} onClick={() => void action('post')}>Post approved adjustment</Button><Button variant="outline" disabled={command.pending} onClick={() => void action('cancel')}>Cancel adjustment</Button></div> : null}
    </CardContent></Card> : null}
    <Card><CardHeader><CardTitle>Adjustment history</CardTitle></CardHeader><CardContent><ul className="divide-y">{rows.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{row.reference_no}</p><p className="text-sm text-muted-foreground">{row.warehouse.name} · {kinds[row.adjustment_type] ?? row.adjustment_type}</p></div><Badge variant="secondary">{row.status.replaceAll('_', ' ')}</Badge><Button variant="outline" disabled={loading || command.pending} onClick={() => void view(row.id)}>View adjustment</Button></li>)}</ul>{!loading && !rows.length ? <p>No stock adjustments yet.</p> : null}{cursor ? <Button variant="outline" disabled={loading} onClick={() => void load(cursor)}>Load older adjustments</Button> : null}</CardContent></Card>
  </div>;
}
