'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useDashboardSession } from '@/components/dashboard/session';
import { useWorkflowMutation } from '@/hooks/useWorkflowMutation';
import { EntityPicker, type BusinessEntity } from '@/components/shared/EntityPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

interface Transfer {
  id: string; reference_no: string; status: string; notes?: string;
  from_warehouse: BusinessEntity; to_warehouse: BusinessEntity;
  requested_at: string; dispatched_at?: string; received_at?: string;
  items?: { id: string; product: BusinessEntity; qty_requested: string; qty_dispatched: string; qty_received: string }[];
}
export default function TransfersPage() {
  const session = useDashboardSession();
  const allowed = (permission: string) => !!(session?.is_global || session?.permissions.includes(permission));
  const [items, setItems] = useState<Transfer[]>([]);
  const [detail, setDetail] = useState<Transfer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [from, setFrom] = useState<BusinessEntity | null>(null);
  const [to, setTo] = useState<BusinessEntity | null>(null);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<{ key: string; product: BusinessEntity | null; qty: string }[]>([{ key: 'initial', product: null, qty: '' }]);
  const command = useWorkflowMutation();
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await apiFetch('/api/v1/transfers'); const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? 'Unable to load transfers');
      setItems(data.items ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load transfers'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function view(id: string) {
    setLoading(true); setError('');
    try {
      const response = await apiFetch(`/api/v1/transfers/${id}`); const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? 'Unable to load transfer');
      setDetail(data); setReason('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load transfer'); }
    finally { setLoading(false); }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!from || !to || from.id === to.id || lines.some(line => !line.product || Number(line.qty) <= 0)) { command.setError('Select different warehouses and complete every product quantity.'); return; }
    if (!window.confirm('Create transfer and reserve these quantities at the source warehouse?')) return;
    const result = await command.mutate<{ transferId: string }>('/api/v1/transfers', {
      from_warehouse_id: from.id, to_warehouse_id: to.id, notes,
      items: lines.map(line => ({ product_id: line.product!.id, qty_requested: Number(line.qty) })),
    });
    if (result) { setCreating(false); setLines([{ key: crypto.randomUUID(), product: null, qty: '' }]); setNotes(''); toast.success('Transfer created; source stock reserved.'); await load(); await view(result.transferId); }
  }
  async function action(kind: 'dispatch' | 'receive' | 'cancel') {
    if (!detail) return;
    if (kind === 'cancel' && !reason.trim()) { command.setError('Enter a cancellation reason.'); return; }
    const messages = { dispatch: 'Dispatch all reserved stock into transit?', receive: 'Confirm all dispatched items arrived at the destination warehouse?', cancel: 'Cancel transfer and release its stock reservations?' };
    if (!window.confirm(messages[kind])) return;
    const result = await command.mutate(`/api/v1/transfers/${detail.id}/${kind}`, kind === 'cancel' ? { reason: reason.trim() } : {});
    if (result) { toast.success('Transfer updated.'); await load(); await view(detail.id); }
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold">Stock transfers</h1><p className="text-muted-foreground">Reserve, dispatch and receive stock between warehouses.</p></div><div className="flex gap-2"><Button variant="outline" disabled={loading || command.pending} onClick={() => void load()}>Refresh</Button>{allowed('transfer.dispatch') ? <Button onClick={() => setCreating(true)}>New transfer</Button> : null}</div></div>
    {error || command.error ? <div role="alert" className="rounded-md border p-4">{error || command.error}</div> : null}
    {loading ? <p role="status">Loading transfers…</p> : null}
    {creating ? <Card><CardHeader><CardTitle>New transfer</CardTitle></CardHeader><CardContent><form onSubmit={create}><fieldset disabled={command.pending} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><EntityPicker label="Source warehouse" endpoint="/api/v1/warehouses" serverSearch={false} value={from} onChange={setFrom} /><EntityPicker label="Destination warehouse" endpoint="/api/v1/warehouses" serverSearch={false} value={to} onChange={setTo} /></div>
      {lines.map((line, index) => <div key={line.key} className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[1fr_8rem_auto]"><EntityPicker label={`Product ${index + 1}`} endpoint="/api/v1/products?is_active=true" value={line.product} onChange={product => setLines(current => current.map(item => item.key === line.key ? { ...item, product } : item))} /><div><Label htmlFor={`qty-${line.key}`}>Quantity</Label><Input id={`qty-${line.key}`} required type="number" min="0.0001" step="0.0001" value={line.qty} onChange={e => setLines(current => current.map(item => item.key === line.key ? { ...item, qty: e.target.value } : item))} /></div><Button type="button" variant="outline" disabled={lines.length === 1} aria-label={`Remove transfer line ${index + 1}`} onClick={() => setLines(current => current.filter(item => item.key !== line.key))}>Remove line</Button></div>)}
      <Button type="button" variant="outline" onClick={() => setLines(current => [...current, { key: crypto.randomUUID(), product: null, qty: '' }])}>Add line</Button><div><Label htmlFor="transfer-notes">Notes</Label><Textarea id="transfer-notes" value={notes} onChange={e => setNotes(e.target.value)} /></div>
      <div className="flex gap-2"><Button type="submit">{command.pending ? 'Creating…' : 'Create transfer'}</Button><Button type="button" variant="outline" onClick={() => { if (window.confirm('Discard this transfer draft?')) setCreating(false); }}>Cancel</Button></div>
    </fieldset></form></CardContent></Card> : null}
    {detail ? <Card><CardHeader className="flex flex-wrap flex-row justify-between gap-2"><CardTitle>{detail.reference_no}</CardTitle><Button variant="outline" disabled={command.pending} onClick={() => setDetail(null)}>Close details</Button></CardHeader><CardContent className="space-y-4">
      <Badge>{detail.status.replaceAll('_', ' ')}</Badge><p>{detail.from_warehouse.name} → {detail.to_warehouse.name}</p>{detail.notes ? <p className="whitespace-pre-wrap">{detail.notes}</p> : null}
      <dl className="grid gap-3 text-sm sm:grid-cols-3">{[['Requested', detail.requested_at], ['Dispatched', detail.dispatched_at], ['Received', detail.received_at]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{value ? new Date(value).toLocaleString() : 'Not yet'}</dd></div>)}</dl>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th>Product</th><th>Requested</th><th>Dispatched</th><th>Received</th></tr></thead><tbody>{detail.items?.map(line => <tr key={line.id} className="border-b"><td className="py-3 pr-3">{line.product.name} ({line.product.code})</td><td>{line.qty_requested}</td><td>{line.qty_dispatched}</td><td>{line.qty_received}</td></tr>)}</tbody></table></div>
      {detail.status === 'pending' && allowed('transfer.dispatch') ? <div className="space-y-3"><Button disabled={command.pending} onClick={() => void action('dispatch')}>Dispatch transfer</Button><div><Label htmlFor="transfer-reason">Cancellation reason</Label><Input id="transfer-reason" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></div><Button variant="outline" disabled={command.pending || !reason.trim()} onClick={() => void action('cancel')}>Cancel transfer</Button></div> : null}
      {detail.status === 'in_transit' && allowed('transfer.receive') ? <Button disabled={command.pending} onClick={() => void action('receive')}>Receive transfer</Button> : null}
    </CardContent></Card> : null}
    <Card><CardHeader><CardTitle>Recent transfers</CardTitle></CardHeader><CardContent>{!loading && !items.length ? <p>No transfers yet.</p> : <ul className="divide-y">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{item.reference_no}</p><p className="text-sm text-muted-foreground">{item.from_warehouse.name} → {item.to_warehouse.name}</p></div><Badge variant="secondary">{item.status.replaceAll('_', ' ')}</Badge><Button variant="outline" disabled={command.pending || loading} onClick={() => void view(item.id)}>View transfer</Button></li>)}</ul>}</CardContent></Card>
  </div>;
}
