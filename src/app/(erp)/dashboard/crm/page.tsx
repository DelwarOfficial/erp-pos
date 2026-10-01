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

type LeadStatus = BusinessEntity & { isWon?: boolean; isLost?: boolean };
type LeadSummary = { id: string; name: string; company_name: string | null; phone: string | null; email: string | null; next_action_at: string | null; status: LeadStatus; assignee: BusinessEntity | null; converted_customer_id: string | null };
type LeadDetail = { id: string; name: string; companyName: string | null; phone: string | null; email: string | null; estimatedValue: string | null; nextActionAt: string | null; notes: string | null; lostReason: string | null;
  branch: BusinessEntity | null; status: LeadStatus; source: BusinessEntity | null; subject: BusinessEntity | null; assignee: BusinessEntity | null; convertedCustomer: BusinessEntity | null;
  activities: { id: string; summary: string; details: string | null; createdAt: string; creator: { name: string } }[] };

export default function CRMPage() {
  const session = useDashboardSession();
  const can = (permission: string) => !!(session?.is_global || session?.permissions.includes(permission));
  const mutation = useWorkflowMutation();
  const [items, setItems] = useState<LeadSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [today, setToday] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [editor, setEditor] = useState<LeadDetail | 'new' | null>(null);
  const load = useCallback(async (after?: string) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: '50', search: query, today: String(today) }); if (after) params.set('cursor', after);
      const response = await apiFetch(`/api/v1/leads?${params}`); const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? 'Unable to load leads');
      setItems(current => after ? [...current, ...data.items] : data.items); setCursor(data.has_more ? data.next_cursor : null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load leads'); } finally { setLoading(false); }
  }, [query, today]);
  useEffect(() => { void load(); }, [load]);
  async function view(id: string) {
    setOpening(id); setError('');
    try { const response = await apiFetch(`/api/v1/leads/${id}`); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message ?? 'Unable to open lead'); setDetail(data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to open lead'); } finally { setOpening(null); }
  }
  async function convert() {
    if (!detail || !window.confirm(`Convert ${detail.name} to a customer? Existing matching contact details may link this lead to an existing customer.`)) return;
    const result = await mutation.mutate(`/api/v1/leads/${detail.id}`, { action: 'convert' });
    if (result) { toast.success('Lead converted to customer.'); await view(detail.id); await load(); }
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">CRM — Leads</h1><p className="text-muted-foreground">Manage contacts, follow-ups and customer conversion.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={loading} onClick={() => void load()}>Refresh</Button>{can('crm.lead.create') ? <Button disabled={!!editor || mutation.pending} onClick={() => setEditor('new')}>New lead</Button> : null}</div></div>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setQuery(search); }}><div className="min-w-0 flex-1"><Label htmlFor="lead-search">Search leads</Label><Input id="lead-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, company or phone" /></div><Button variant="outline" type="submit">Search</Button><Button type="button" variant={today ? 'default' : 'outline'} aria-pressed={today} onClick={() => setToday(value => !value)}>Today’s actions</Button></form>
    {error || mutation.error ? <div role="alert" className="space-y-2 rounded-md border p-3"><p>{error || mutation.error}</p><Button variant="outline" onClick={() => void load()}>Retry lead list</Button></div> : null}
    {editor ? <LeadEditor key={editor === 'new' ? 'new' : editor.id} initial={editor === 'new' ? null : editor} onCancel={() => setEditor(null)} onSaved={async id => { setEditor(null); await load(); await view(id); }} /> : null}
    {detail && !editor ? <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3"><CardTitle><h2>{detail.name}</h2></CardTitle><Button variant="outline" disabled={mutation.pending} onClick={() => setDetail(null)}>Close lead</Button></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap gap-2"><Badge>{detail.status.name}</Badge>{detail.convertedCustomer ? <Badge variant="secondary">Customer: {detail.convertedCustomer.name}</Badge> : null}</div>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[['Company', detail.companyName], ['Branch', detail.branch?.name], ['Phone', detail.phone], ['Email', detail.email], ['Assignee', detail.assignee?.name], ['Source', detail.source?.name], ['Subject', detail.subject?.name], ['Estimated value', detail.estimatedValue], ['Next action', detail.nextActionAt ? new Date(detail.nextActionAt).toLocaleString() : null]].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="break-words">{value || 'Not set'}</dd></div>)}</dl>
      {detail.notes ? <p className="whitespace-pre-wrap break-words">{detail.notes}</p> : null}{detail.lostReason ? <p>Lost reason: {detail.lostReason}</p> : null}
      <div className="flex flex-wrap gap-2">{can('crm.lead.update') ? <Button variant="outline" disabled={mutation.pending} onClick={() => setEditor(detail)}>Edit lead</Button> : null}{can('lead.convert') && !detail.convertedCustomer ? <Button disabled={mutation.pending} onClick={() => void convert()}>Convert to customer</Button> : null}</div>
      <section><h3 className="font-semibold">Recent activity</h3>{detail.activities.length ? <ul className="divide-y">{detail.activities.map(activity => <li key={activity.id} className="space-y-1 py-3"><p>{activity.summary}</p>{activity.details ? <p className="whitespace-pre-wrap break-words text-sm">{activity.details}</p> : null}<p className="text-xs text-muted-foreground">{activity.creator.name} · {new Date(activity.createdAt).toLocaleString()}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">No activity recorded yet.</p>}</section>
    </CardContent></Card> : null}
    {loading ? <p role="status">Loading leads…</p> : null}
    <Card><CardHeader><CardTitle>Leads ({items.length})</CardTitle></CardHeader><CardContent className="space-y-3">{!loading && !items.length ? <p className="text-muted-foreground">No matching leads. Adjust your filters or create a lead.</p> : items.map(lead => <article key={lead.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0 space-y-1"><h2 className="break-words font-medium">{lead.name}</h2><p className="break-words text-sm text-muted-foreground">{[lead.company_name, lead.phone, lead.email].filter(Boolean).join(' · ')}</p><Badge variant={lead.status.isLost ? 'destructive' : 'secondary'}>{lead.status.name}</Badge>{lead.next_action_at ? <p className="text-sm">Follow up: {new Date(lead.next_action_at).toLocaleString()}</p> : null}</div><Button variant="outline" disabled={!!opening || !!editor || mutation.pending} onClick={() => void view(lead.id)}>{opening === lead.id ? 'Opening…' : 'View lead'}</Button></article>)}{cursor ? <Button variant="outline" disabled={loading} onClick={() => void load(cursor)}>Load more leads</Button> : null}</CardContent></Card>
  </div>;
}

function localDateTime(value: string | null | undefined) {
  if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function LeadEditor({ initial, onCancel, onSaved }: { initial: LeadDetail | null; onCancel: () => void; onSaved: (id: string) => Promise<void> }) {
  const mutation = useWorkflowMutation();
  const defaults = { name: initial?.name ?? '', company_name: initial?.companyName ?? '', phone: initial?.phone ?? '', email: initial?.email ?? '', estimated_value: initial?.estimatedValue ?? '', next_action_at: localDateTime(initial?.nextActionAt), notes: initial?.notes ?? '', lost_reason: initial?.lostReason ?? '' };
  const [form, setForm] = useState(defaults);
  const [branch, setBranch] = useState(initial?.branch ?? null);
  const [status, setStatus] = useState<LeadStatus | null>(initial?.status ?? null);
  const [source, setSource] = useState(initial?.source ?? null);
  const [subject, setSubject] = useState(initial?.subject ?? null);
  const [assignee, setAssignee] = useState(initial?.assignee ?? null);
  const dirty = JSON.stringify(form) !== JSON.stringify(defaults) || branch?.id !== initial?.branch?.id || status?.id !== initial?.status?.id || source?.id !== initial?.source?.id || subject?.id !== initial?.subject?.id || assignee?.id !== initial?.assignee?.id;
  useDraftProtection(dirty);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!branch && !initial) { mutation.setError('Select a branch for this lead.'); return; }
    if (!form.phone.trim() && !form.email.trim()) { mutation.setError('Enter a phone number or email address.'); return; }
    const lead = { ...form, branch_id: branch?.id, status_id: status?.id, source_id: source?.id ?? null, subject_id: subject?.id ?? null, assigned_to: assignee?.id ?? null, estimated_value: form.estimated_value === '' ? null : Number(form.estimated_value), next_action_at: form.next_action_at ? new Date(form.next_action_at).toISOString() : null };
    const result = await mutation.mutate<{ id: string }>(initial ? `/api/v1/leads/${initial.id}` : '/api/v1/leads', initial ? { action: 'update', lead } : lead);
    if (result) { toast.success(initial ? 'Lead updated.' : 'Lead created.'); await onSaved(result.id); }
  }
  return <Card><CardHeader><CardTitle>{initial ? 'Edit lead' : 'New lead'}</CardTitle></CardHeader><CardContent><form onSubmit={save}><fieldset disabled={mutation.pending} className="space-y-4">
    {mutation.error ? <p role="alert" className="text-destructive">{mutation.error}</p> : null}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {(['name', 'company_name', 'phone', 'email', 'estimated_value', 'next_action_at'] as const).map(key => <div key={key}><Label htmlFor={`lead-${key}`}>{({ name: 'Lead name', company_name: 'Company name', phone: 'Phone', email: 'Email', estimated_value: 'Estimated value', next_action_at: 'Next follow-up' })[key]}</Label><Input id={`lead-${key}`} required={key === 'name'} type={key === 'email' ? 'email' : key === 'estimated_value' ? 'number' : key === 'next_action_at' ? 'datetime-local' : 'text'} min={key === 'estimated_value' ? '0' : undefined} step={key === 'estimated_value' ? '0.01' : undefined} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} /></div>)}
      <EntityPicker label="Lead branch" endpoint="/api/v1/branches" serverSearch={false} value={branch} onChange={setBranch} />
      <div><EntityPicker label="Lead status" endpoint="/api/v1/leads/options?kind=status" disabled={!!initial?.convertedCustomer} value={status} onChange={setStatus} />{!initial && !status ? <p className="text-xs text-muted-foreground">Uses the first open status, or creates New when no open status exists.</p> : null}</div>
      {([{ label: 'Lead source', kind: 'source', value: source, change: setSource }, { label: 'Lead subject', kind: 'subject', value: subject, change: setSubject }, { label: 'Lead assignee', kind: 'assignee', value: assignee, change: setAssignee }]).map(option => <div key={option.kind}><EntityPicker label={option.label} endpoint={`/api/v1/leads/options?kind=${option.kind}`} value={option.value} onChange={option.change} />{option.value ? <Button type="button" variant="ghost" onClick={() => option.change(null)}>Clear {option.kind}</Button> : null}</div>)}
    </div>
    {status?.isLost ? <div><Label htmlFor="lead-lost">Lost reason</Label><Textarea id="lead-lost" required value={form.lost_reason} onChange={event => setForm(current => ({ ...current, lost_reason: event.target.value }))} /></div> : null}
    <div><Label htmlFor="lead-notes">Lead notes</Label><Textarea id="lead-notes" value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} /></div>
    <div className="flex flex-wrap gap-2"><Button type="submit">{mutation.pending ? 'Saving…' : initial ? 'Save lead' : 'Create lead'}</Button><Button type="button" variant="outline" onClick={() => { if (!dirty || window.confirm('Discard unsaved lead changes?')) onCancel(); }}>Cancel lead</Button></div>
  </fieldset></form></CardContent></Card>;
}
