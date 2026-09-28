// Collection follow-through on a customer's profile: promises to pay,
// follow-up tasks and changing an installment's due date. Every rule is
// enforced by the server; these forms only collect the input.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Loader2, Plus, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/shared/StateList';
import { apiFetch } from '@/lib/api/client';
import { useDashboardSession } from '@/components/dashboard/session';
import { newIdempotencyKey, readError, Taka, useCan } from './common';

export interface OpenInstallment { installment_id: string; sale_id: string; sale_reference_no: string; installment_no: number; due_date: string; outstanding: string; status: string }

interface PromiseRow {
  id: string; reference_no: string; installment_no: number | null; original_due_date: string | null; promised_date: string;
  promised_amount: string; collected: string; status: 'open' | 'kept' | 'broken' | 'cancelled'; note: string | null;
  recorded_by_name: string; created_at: string; cancel_reason: string | null;
}
interface FollowUpRow {
  id: string; followUpType: string; status: string; dueAt: string; note: string | null; outcomeNote: string | null;
  sale: { referenceNo: string } | null; installment: { installmentNo: number } | null; assignee: { name: string } | null;
}

const PROMISE_BADGE: Record<PromiseRow['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = { open: 'secondary', kept: 'default', broken: 'destructive', cancelled: 'outline' };
export const FOLLOW_UP_LABELS: Record<string, string> = {
  call: 'Call customer', visit: 'Visit customer', send_reminder: 'Send reminder', call_later: 'Call later',
  payment_promised: 'Payment promised', escalate: 'Escalate to manager', other: 'Other',
};
const todayIso = () => new Date().toLocaleDateString('en-CA');

async function post(url: string, body: unknown, prefix: string, method = 'POST') {
  const r = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey(prefix) }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

// ── promises ────────────────────────────────────────────────────────────────

export function PromisesCard({ customerId, installments, onChange }: { customerId: string; installments: OpenInstallment[]; onChange: () => void }) {
  const can = useCan();
  const [rows, setRows] = useState<PromiseRow[] | null>(null);
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const r = await apiFetch(`/api/v1/collections/promises?customer_id=${customerId}&limit=50`);
    setRows(r.ok ? (await r.json()).items : []);
  }, [customerId]);
  useEffect(() => { void load(); }, [load]);
  const open = installments.filter(i => i.status !== 'paid');

  async function record(e: React.FormEvent) {
    e.preventDefault();
    const inst = open.find(i => i.installment_id === target);
    if (!inst) { toast.error('Choose the installment'); return; }
    setSaving(true);
    try {
      await post('/api/v1/collections/promises', { sale_id: inst.sale_id, installment_id: inst.installment_id, promised_date: date, amount: amount.trim(), note: note || undefined }, 'promise');
      toast.success('Promise recorded. The due date is unchanged.');
      setAmount(''); setNote(''); setDate('');
      void load(); onChange();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not record the promise'); }
    finally { setSaving(false); }
  }
  async function cancel(id: string) {
    const reason = window.prompt('Why is this promise cancelled?');
    if (!reason?.trim()) return;
    try { await post(`/api/v1/collections/promises/${id}/cancel`, { reason }, 'promise-cancel'); void load(); onChange(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not cancel'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Promises to pay</CardTitle>
        <CardDescription>A promise does not change the due date; both are kept. It counts as kept when the promised amount is collected by the end of the promised day.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {can('collection.manage.branch') && open.length > 0 && (
          <form className="grid gap-3 md:grid-cols-5" onSubmit={record}>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="promise-installment">Installment</Label>
              <Select value={target} onValueChange={v => { setTarget(v); const i = open.find(x => x.installment_id === v); if (i && !amount) setAmount(i.outstanding); }}>
                <SelectTrigger id="promise-installment"><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>{open.map(i => <SelectItem key={i.installment_id} value={i.installment_id}>{i.sale_reference_no} #{i.installment_no} · due {i.due_date} · ৳{i.outstanding}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label htmlFor="promise-date">Promised date</Label><Input id="promise-date" type="date" min={todayIso()} value={date} onChange={e => setDate(e.target.value)} required /></div>
            <div className="space-y-1"><Label htmlFor="promise-amount">Amount (৳)</Label><Input id="promise-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} required /></div>
            <div className="flex items-end"><Button type="submit" disabled={saving} className="w-full">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record</Button></div>
            <div className="space-y-1 md:col-span-5"><Label htmlFor="promise-note">Note</Label><Input id="promise-note" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} placeholder="What the customer said" /></div>
          </form>
        )}
        {!rows ? null : rows.length === 0 ? <EmptyState message="No promises recorded." /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Due date</TableHead><TableHead>Promised</TableHead>
                <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Collected</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{rows.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap">{p.reference_no}{p.installment_no ? ` #${p.installment_no}` : ''}</TableCell>
                  <TableCell>{p.original_due_date ?? '—'}</TableCell>
                  <TableCell>{p.promised_date}<div className="text-xs text-muted-foreground">by {p.recorded_by_name}</div></TableCell>
                  <TableCell className="text-right"><Taka value={p.promised_amount} /></TableCell>
                  <TableCell className="text-right"><Taka value={p.collected} /></TableCell>
                  <TableCell><Badge variant={PROMISE_BADGE[p.status]}>{p.status}</Badge>{p.cancel_reason && <div className="text-xs text-muted-foreground">{p.cancel_reason}</div>}</TableCell>
                  <TableCell className="text-right">{p.status === 'open' && can('collection.manage.branch') && <Button size="sm" variant="ghost" onClick={() => cancel(p.id)}>Cancel</Button>}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── follow-ups ──────────────────────────────────────────────────────────────

export function FollowUpsCard({ customerId, installments, onChange }: { customerId: string; installments: OpenInstallment[]; onChange: () => void }) {
  const can = useCan();
  const me = useDashboardSession();
  const [rows, setRows] = useState<FollowUpRow[] | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [type, setType] = useState('call');
  const [when, setWhen] = useState('');
  const [assignee, setAssignee] = useState('');
  const [target, setTarget] = useState('none');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const r = await apiFetch(`/api/v1/collections/follow-ups?customer_id=${customerId}&limit=50`);
    setRows(r.ok ? (await r.json()).items : []);
  }, [customerId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!can('user.read')) return;
    void apiFetch('/api/v1/admin/users?status=active&size=100').then(async r => { if (r.ok) setUsers((await r.json()).data ?? []); });
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const inst = installments.find(i => i.installment_id === target);
    setSaving(true);
    try {
      await post('/api/v1/collections/follow-ups', {
        customer_id: customerId, sale_id: inst?.sale_id, installment_id: inst?.installment_id, type,
        due_at: new Date(when).toISOString(), assigned_to: assignee || me?.id, note: note || undefined,
      }, 'follow-up');
      toast.success('Follow-up added');
      setNote(''); setWhen('');
      void load(); onChange();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not add the follow-up'); }
    finally { setSaving(false); }
  }
  async function close(id: string, outcome: 'done' | 'cancelled') {
    const outcomeNote = window.prompt(outcome === 'done' ? 'What happened?' : 'Why is it cancelled?') ?? undefined;
    if (outcomeNote === undefined) return;
    try { await post(`/api/v1/collections/follow-ups/${id}/close`, { outcome, note: outcomeNote || undefined }, 'follow-up-close'); void load(); onChange(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not update'); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Follow-ups</CardTitle><CardDescription>Calls, visits and escalations for this customer.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {can('collection.manage.branch') && (
          <form className="grid gap-3 md:grid-cols-4" onSubmit={create}>
            <div className="space-y-1">
              <Label htmlFor="fu-type">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="fu-type"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(FOLLOW_UP_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label htmlFor="fu-when">When</Label><Input id="fu-when" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} required /></div>
            <div className="space-y-1">
              <Label htmlFor="fu-assignee">Assigned to</Label>
              <Select value={assignee || me?.id || ''} onValueChange={setAssignee}>
                <SelectTrigger id="fu-assignee"><SelectValue placeholder="Me" /></SelectTrigger>
                <SelectContent>
                  {me && <SelectItem value={me.id}>Me ({me.name})</SelectItem>}
                  {users.filter(u => u.id !== me?.id).map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fu-about">About</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger id="fu-about"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">The customer in general</SelectItem>
                  {installments.filter(i => i.status !== 'paid').map(i => <SelectItem key={i.installment_id} value={i.installment_id}>{i.sale_reference_no} #{i.installment_no}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-3"><Label htmlFor="fu-note">Note</Label><Textarea id="fu-note" rows={1} value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /></div>
            <div className="flex items-end"><Button type="submit" disabled={saving} className="w-full">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Add follow-up</Button></div>
          </form>
        )}
        {!rows ? null : rows.length === 0 ? <EmptyState message="No follow-ups." /> : (
          <ul className="divide-y">
            {rows.map(f => {
              const overdue = f.status === 'open' && new Date(f.dueAt) < new Date();
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className={`w-40 shrink-0 ${overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>{new Date(f.dueAt).toLocaleString()}</span>
                  <span className="font-medium">{FOLLOW_UP_LABELS[f.followUpType] ?? f.followUpType}</span>
                  {f.sale && <span className="text-muted-foreground">{f.sale.referenceNo}{f.installment ? ` #${f.installment.installmentNo}` : ''}</span>}
                  {f.assignee && <span className="text-muted-foreground">→ {f.assignee.name}</span>}
                  <Badge variant={f.status === 'open' ? (overdue ? 'destructive' : 'secondary') : 'outline'}>{f.status}</Badge>
                  {f.status === 'open' && can('collection.manage.branch') && (
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => close(f.id, 'done')}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Done</Button>
                      <Button size="sm" variant="ghost" onClick={() => close(f.id, 'cancelled')}><XCircle className="mr-1 h-3.5 w-3.5" />Cancel</Button>
                    </span>
                  )}
                  {(f.note || f.outcomeNote) && <p className="w-full text-xs text-muted-foreground">{f.note}{f.outcomeNote ? ` — ${f.outcomeNote}` : ''}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── due-date change ─────────────────────────────────────────────────────────

export function RescheduleDialog({ installment, onClose, onDone }: { installment: OpenInstallment | null; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<Array<{ old_due_date: string; new_due_date: string; reason: string; changed_by: string; changed_at: string }>>([]);
  useEffect(() => {
    setDate(''); setReason(''); setHistory([]);
    if (!installment) return;
    void apiFetch(`/api/v1/collections/installments/${installment.installment_id}/due-date`).then(async r => { if (r.ok) setHistory((await r.json()).items); });
  }, [installment]);

  async function save() {
    if (!installment) return;
    setSaving(true);
    try {
      const result = await post(`/api/v1/collections/installments/${installment.installment_id}/due-date`, { due_date: date, reason }, 'reschedule');
      toast.success(`Due date changed to ${result.new_due_date}`);
      onClose(); onDone();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not change the date'); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={installment !== null} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5" />Change the due date</DialogTitle>
          <DialogDescription>
            {installment && <>{installment.sale_reference_no} #{installment.installment_no}, now due {installment.due_date}. </>}
            This changes the agreed date: it is recorded with your reason, and reminders move to the new date. To note a customer&apos;s promise instead, record a promise to pay.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="new-due">New due date</Label><Input id="new-due" type="date" min={todayIso()} value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="due-reason">Reason</Label><Textarea id="due-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} /></div>
          {history.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <p className="font-medium">Earlier changes</p>
              {history.map((h, i) => <p key={i}>{h.old_due_date} → {h.new_due_date} by {h.changed_by}: {h.reason}</p>)}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={save} disabled={saving || !date || reason.trim().length < 3}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Change date</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
