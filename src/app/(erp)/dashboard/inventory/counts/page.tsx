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

type CountLine = { id: string; product: BusinessEntity & { isSerialized: boolean }; batch: { batchNo: string } | null; expected_quantity: string | null; counted_quantity: string | null; variance_quantity: string | null; reason_code: BusinessEntity | null; count_note: string | null; serials: { serial_number: string; counted: boolean; resolution?: string }[] };
type Count = { id: string; reference_no: string; status: string; warehouse: BusinessEntity; blind_count: boolean; movement_freeze_policy: string; snapshot_at: string; item_count?: number; items?: CountLine[]; approval?: { id: string; status: string; requestedBy: string } | null };
type Draft = { qty: string; note: string; reason: BusinessEntity | null; serials: string };
export default function StockCountsPage() {
  const session = useDashboardSession(); const can = (permission: string) => !!(session?.is_global || session?.permissions.includes(permission));
  const command = useWorkflowMutation();
  const [rows, setRows] = useState<Count[]>([]); const [total, setTotal] = useState(0); const [detail, setDetail] = useState<Count | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [creating, setCreating] = useState(false);
  const [warehouse, setWarehouse] = useState<BusinessEntity | null>(null); const [scope, setScope] = useState('all'); const [entity, setEntity] = useState<BusinessEntity | null>(null);
  const [blind, setBlind] = useState(true); const [freeze, setFreeze] = useState('block'); const [notes, setNotes] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}); const [dirty, setDirty] = useState(false); const [query, setQuery] = useState(''); const [page, setPage] = useState(0);
  useDraftProtection(dirty || creating && !!(warehouse || notes));
  const load = useCallback(async (offset = 0) => {
    setLoading(true); setError('');
    try { const res = await apiFetch(`/api/v1/stock-counts?limit=50&offset=${offset}`); const data = await res.json(); if (!res.ok) throw new Error(data.error?.message ?? 'Unable to load counts'); setRows(current => offset ? [...current, ...data.items] : data.items); setTotal(data.total); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load counts'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function view(id: string) {
    if (dirty && !window.confirm('Discard unsaved counts and open this document?')) return;
    setLoading(true); setError('');
    try { const res = await apiFetch(`/api/v1/stock-counts/${id}`); const data = await res.json(); if (!res.ok) throw new Error(data.error?.message ?? 'Unable to load count');
      const count = data.item as Count; setDetail(count); setDrafts(Object.fromEntries((count.items ?? []).map(line => [line.id, { qty: line.counted_quantity ?? '', note: line.count_note ?? '', reason: line.reason_code, serials: line.serials.filter(serial => serial.counted).map(serial => serial.serial_number).join('\n') }]))); setDirty(false); setQuery(''); setPage(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load count'); } finally { setLoading(false); }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (!warehouse?.branch || scope !== 'all' && !entity) { command.setError('Select a warehouse and the requested scope.'); return; }
    if (!window.confirm(`Create inventory snapshot? ${freeze === 'block' ? 'Stock movements for these products will stop until this count is posted or cancelled.' : 'Movements remain possible; count against the snapshot and account for subsequent movements.'}`)) return;
    const result = await command.mutate<{ id: string }>('/api/v1/stock-counts', { warehouse_id: warehouse.id, branch_id: warehouse.branch.id, scope_type: scope, category_id: scope === 'category' ? entity!.id : undefined, brand_id: scope === 'brand' ? entity!.id : undefined, blind_count: blind, movement_freeze_policy: freeze, notes });
    if (result) { setCreating(false); setNotes(''); toast.success('Stock count snapshot created.'); await load(); await view(result.id); }
  }
  function update(id: string, patch: Partial<Draft>) { setDrafts(current => ({ ...current, [id]: { ...current[id], ...patch } })); setDirty(true); }
  async function action(kind: string) {
    if (!detail) return;
    if (kind !== 'save' && dirty) { command.setError('Save counted quantities before continuing.'); return; }
    const items = kind === 'save' ? Object.entries(drafts).filter(([, value]) => value.qty !== '').map(([id, value]) => ({ id, quantity: Number(value.qty), note: value.note, reason_code_id: value.reason?.id, serial_numbers: value.serials.split(/[\s,]+/).filter(Boolean) })) : undefined;
    if (kind === 'save' && (!items?.length || items.some(item => !Number.isFinite(item.quantity) || item.quantity < 0))) { command.setError('Enter at least one valid counted quantity. Use zero for none found.'); return; }
    const messages: Record<string, string> = { post: 'Post reviewed variances to stock and accounting? Missing serialized units will be written off as scrapped. Posted counts cannot be edited.', cancel: 'Cancel this count and release its movement freeze?', reopen: 'Reopen for recount? Existing approvals will be cancelled.', review: 'Finish counting and review all variances?' };
    if (messages[kind] && !window.confirm(messages[kind])) return;
    const result = await command.mutate(`/api/v1/stock-counts/${detail.id}/actions`, { action: kind, items });
    if (result) { setDirty(false); toast.success('Stock count updated.'); const id = detail.id; await load();
      // The saved draft is authoritative now; avoid an unnecessary discard prompt.
      const response = await apiFetch(`/api/v1/stock-counts/${id}`); const data = await response.json(); if (response.ok) setDetail(data.item); else setError(data.error?.message ?? 'Saved, but reload failed. Refresh details.');
    }
  }
  async function resolve(decision: 'approved' | 'rejected') {
    if (!detail?.approval || !window.confirm(`${decision === 'approved' ? 'Approve' : 'Reject'} these reviewed count variances?`)) return;
    const result = await command.mutate(`/api/v1/approvals/${detail.approval.id}/resolve`, { decision, reason: `Stock count ${detail.reference_no} reviewed` });
    if (result) { toast.success('Approval updated.'); await view(detail.id); }
  }
  const filtered = (detail?.items ?? []).filter(line => `${line.product.name} ${line.product.code ?? ''} ${line.batch?.batchNo ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const visible = filtered.slice(page * 50, (page + 1) * 50);
  return <div className="space-y-5">
    <div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold">Stock counts</h1><p className="text-muted-foreground">Snapshot, count, review and post inventory variances.</p></div><div className="flex gap-2"><Button variant="outline" disabled={loading || command.pending} onClick={() => void load()}>Refresh</Button>{can('stock_count.post') ? <Button disabled={creating || command.pending} onClick={() => setCreating(true)}>New stock count</Button> : null}</div></div>
    {error || command.error ? <div role="alert" className="rounded-md border p-4">{error || command.error}{error ? <Button variant="outline" onClick={() => detail ? void view(detail.id) : void load()}>Retry</Button> : null}</div> : null}
    {loading ? <p role="status">Loading stock counts…</p> : null}
    {creating ? <Card><CardHeader><CardTitle>New stock count</CardTitle></CardHeader><CardContent><form onSubmit={create}><fieldset disabled={command.pending} className="space-y-4">
      <EntityPicker label="Count warehouse" endpoint="/api/v1/warehouses" serverSearch={false} value={warehouse} onChange={setWarehouse} />
      <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="count-scope">Scope</Label><select id="count-scope" className="h-11 w-full rounded-md border bg-background px-3" value={scope} onChange={event => { setScope(event.target.value); setEntity(null); }}><option value="all">All active products</option><option value="category">Category</option><option value="brand">Brand</option></select></div>{scope !== 'all' ? <EntityPicker label={scope === 'category' ? 'Count category' : 'Count brand'} endpoint={`/api/v1/${scope === 'category' ? 'categories' : 'brands'}`} serverSearch={false} value={entity} onChange={setEntity} /> : null}</div>
      <div><Label htmlFor="count-freeze">Stock movement policy</Label><select id="count-freeze" className="h-11 w-full rounded-md border bg-background px-3" value={freeze} onChange={event => setFreeze(event.target.value)}><option value="block">Block movements until posting or cancellation</option><option value="warn">Warn — count against the snapshot</option><option value="allow">Allow — count against the snapshot</option></select></div>
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={blind} onChange={event => setBlind(event.target.checked)} />Blind count: hide expected quantities until review</label>
      <div><Label htmlFor="count-notes">Notes</Label><Textarea id="count-notes" value={notes} onChange={event => setNotes(event.target.value)} /></div>
      <div className="flex gap-2"><Button type="submit">Create snapshot</Button><Button type="button" variant="outline" onClick={() => { if ((!warehouse && !notes) || window.confirm('Discard this stock count draft?')) setCreating(false); }}>Cancel</Button></div>
    </fieldset></form></CardContent></Card> : null}
    {detail ? <Card><CardHeader className="flex flex-wrap flex-row items-center justify-between gap-3"><CardTitle>{detail.reference_no}</CardTitle><div className="flex gap-2"><Button variant="outline" disabled={loading || command.pending} onClick={() => void view(detail.id)}>Refresh details</Button><Button variant="outline" disabled={command.pending} onClick={() => { if (!dirty || window.confirm('Discard unsaved count values?')) { setDetail(null); setDirty(false); } }}>Close details</Button></div></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap gap-2"><Badge>{detail.status}</Badge><span>{detail.warehouse.name}</span><span className="text-muted-foreground">Snapshot: {new Date(detail.snapshot_at).toLocaleString()}</span></div>
      {detail.movement_freeze_policy !== 'block' && ['draft', 'counting', 'reviewed'].includes(detail.status) ? <p role="note" className="rounded-md border p-3">Stock movements are allowed. Reconcile any movement after the snapshot before saving physical counts; posting applies the difference from that snapshot.</p> : null}
      {detail.blind_count && ['draft', 'counting'].includes(detail.status) ? <p>Blind count: expected quantities remain hidden until review.</p> : null}
      <div><Label htmlFor="count-filter">Find counted product</Label><Input id="count-filter" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></div>
      <p className="text-sm text-muted-foreground">{detail.items?.filter(line => line.counted_quantity !== null).length} of {detail.items?.length} lines saved. {dirty ? 'Unsaved changes.' : ''}</p>
      <fieldset disabled={command.pending || !can('stock_count.post')} className="space-y-3">
        {visible.map(line => <section key={line.id} className="space-y-3 rounded-md border p-4"><h3 className="font-semibold">{line.product.name} {line.batch ? `· Batch ${line.batch.batchNo}` : ''}</h3><p className="text-sm text-muted-foreground">{line.product.code} · Expected: {line.expected_quantity ?? 'Hidden'} · Variance: {line.variance_quantity ?? 'Not reviewed'}</p>
          {detail.status === 'counting' ? <><div className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor={`count-${line.id}`}>Counted quantity — {line.product.name}</Label><Input id={`count-${line.id}`} type="number" min="0" step={line.product.isSerialized ? '1' : '0.0001'} value={drafts[line.id]?.qty ?? ''} onChange={event => update(line.id, { qty: event.target.value })} /></div><EntityPicker label={`Reason — ${line.product.name}`} endpoint="/api/v1/inventory-reasons" value={drafts[line.id]?.reason ?? null} onChange={reason => update(line.id, { reason })} /><div><Label htmlFor={`note-${line.id}`}>Count note — {line.product.name}</Label><Input id={`note-${line.id}`} maxLength={500} value={drafts[line.id]?.note ?? ''} onChange={event => update(line.id, { note: event.target.value })} /></div></div>{line.product.isSerialized ? <div><Label htmlFor={`serial-${line.id}`}>Scanned serials — {line.product.name}</Label><Textarea id={`serial-${line.id}`} value={drafts[line.id]?.serials ?? ''} onChange={event => update(line.id, { serials: event.target.value })} placeholder="One serial per line" /></div> : null}</> : <><p>Counted: {line.counted_quantity ?? 'Not counted'} · Reason: {line.reason_code?.name ?? 'Not selected'}</p>{line.count_note ? <p>{line.count_note}</p> : null}{line.serials.length ? <ul className="text-sm">{line.serials.map(serial => <li key={serial.serial_number}>{serial.serial_number} — {serial.resolution ?? 'Counted'}</li>)}</ul> : null}</>}
        </section>)}
        {!visible.length ? <p>No matching count lines.</p> : null}
      </fieldset>
      {filtered.length > 50 ? <div className="flex items-center gap-3"><Button variant="outline" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous lines</Button><span>Page {page + 1} of {Math.ceil(filtered.length / 50)}</span><Button variant="outline" disabled={(page + 1) * 50 >= filtered.length} onClick={() => setPage(value => value + 1)}>Next lines</Button></div> : null}
      {detail.approval ? <div className="space-y-2"><p>Variance approval: <Badge>{detail.approval.status}</Badge></p>{detail.approval.status === 'pending' && can('approval.resolve') && detail.approval.requestedBy !== session?.id ? <div className="flex gap-2"><Button disabled={command.pending} onClick={() => void resolve('approved')}>Approve variances</Button><Button variant="outline" disabled={command.pending} onClick={() => void resolve('rejected')}>Reject variances</Button></div> : null}</div> : null}
      {can('stock_count.post') ? <div className="flex flex-wrap gap-2">{detail.status === 'draft' ? <Button disabled={command.pending} onClick={() => void action('start')}>Start counting</Button> : null}{detail.status === 'counting' ? <><Button disabled={command.pending} onClick={() => void action('save')}>Save counts</Button><Button variant="outline" disabled={command.pending || dirty} onClick={() => void action('review')}>Review count</Button></> : null}{detail.status === 'reviewed' ? <><Button disabled={command.pending || !!detail.approval && detail.approval.status !== 'approved'} onClick={() => void action('post')}>Post variances</Button><Button variant="outline" disabled={command.pending} onClick={() => void action('reopen')}>Reopen for recount</Button></> : null}{['draft', 'counting', 'reviewed'].includes(detail.status) ? <Button variant="outline" disabled={command.pending || dirty} onClick={() => void action('cancel')}>Cancel count</Button> : null}</div> : null}
    </CardContent></Card> : null}
    <Card><CardHeader><CardTitle>Count history</CardTitle></CardHeader><CardContent><ul className="divide-y">{rows.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{row.reference_no}</p><p className="text-sm text-muted-foreground">{row.warehouse.name} · {row.item_count} lines</p></div><Badge variant="secondary">{row.status}</Badge><Button variant="outline" disabled={loading || command.pending} onClick={() => void view(row.id)}>View count</Button></li>)}</ul>{!loading && !rows.length ? <p>No stock counts yet.</p> : null}{rows.length < total ? <Button variant="outline" disabled={loading} onClick={() => void load(rows.length)}>Load older counts</Button> : null}</CardContent></Card>
  </div>;
}
