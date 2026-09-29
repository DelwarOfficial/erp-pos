// src/app/(erp)/dashboard/communications/sms/page.tsx
// SMS workspace: today's reminders, message history, the MiMSMS account and the reminder policy.
// Consumes: GET /api/v1/collections/overview, GET /api/v1/communications/messages,
//           POST /api/v1/communications/messages/{id}/resolve, GET|PUT /api/v1/communications/sms-account,
//           GET|PUT /api/v1/communications/reminder-policy, reminder texts (via TemplateEditor).

'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, KeyRound, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, EmptyState } from '@/components/shared/StateList';
import { apiFetch } from '@/lib/api/client';
import { newIdempotencyKey, readError, SKIP_REASONS, SmsStatusBadge, useCan } from '@/components/collections/common';
import { TemplateEditor } from '@/components/collections/TemplateEditor';

interface Message {
  id: string; status: string; triggerSource: string; renderedBody: string; encoding: string | null; segments: number | null;
  providerMessageId: string | null; providerStatus: string | null; lastErrorCode: string | null; attemptCount: number;
  createdAt: string; sentAt: string | null; deliveredAt: string | null; to_masked: string | null;
  customer: { id: string; name: string } | null; sale: { referenceNo: string } | null; installment: { installmentNo: number } | null;
}

const STATUSES = ['all', 'queued', 'sent', 'delivered', 'failed', 'unknown', 'dead_letter', 'skipped', 'cancelled'];
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const minuteOf = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };

function History({ initialStatus }: { initialStatus: string }) {
  const can = useCan();
  const [status, setStatus] = useState(initialStatus);
  const [trigger, setTrigger] = useState('all');
  const [items, setItems] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const load = useCallback(async (after: string | null) => {
    const params = new URLSearchParams({ limit: '50' });
    if (status !== 'all') params.set('status', status);
    if (trigger !== 'all') params.set('trigger', trigger);
    if (after) params.set('cursor', after);
    if (!after) { setLoading(true); setError(null); }
    try {
      const r = await apiFetch(`/api/v1/communications/messages?${params}`);
      if (!r.ok) throw new Error(await readError(r));
      const data = await r.json();
      setItems(prev => (after ? [...prev, ...data.items] : data.items));
      setCursor(data.next_cursor);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load messages'); }
    finally { setLoading(false); }
  }, [status, trigger]);
  useEffect(() => { void load(null); }, [load]);

  async function resolve(id: string, outcome: 'sent' | 'not_sent') {
    setResolving(id);
    try {
      const r = await apiFetch(`/api/v1/communications/messages/${id}/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey('sms-resolve') },
        body: JSON.stringify({ outcome, note: 'Checked in the MiMSMS panel' }),
      });
      if (!r.ok) throw new Error(await readError(r));
      toast.success(outcome === 'sent' ? 'Marked as sent' : 'Marked as not sent');
      void load(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update the message'); }
    finally { setResolving(null); }
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div>
          <CardTitle>Message history</CardTitle>
          <CardDescription>Numbers are masked. An <strong>unknown</strong> message may or may not have reached the customer: check the MiMSMS panel&apos;s sent-SMS report for that number and time, then mark it. It is never resent automatically.</CardDescription>
        </div>
        <div className="flex flex-wrap gap-3">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s === 'all' ? 'All statuses' : s.replace('_', ' ')}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={trigger} onValueChange={setTrigger}>
            <SelectTrigger className="w-44" aria-label="Source"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Automatic and manual</SelectItem><SelectItem value="reminder">Automatic</SelectItem><SelectItem value="manual">Manual</SelectItem></SelectContent>
          </Select>
          <Button variant="outline" onClick={() => load(null)}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? <ErrorState message={error} onRetry={() => load(null)} /> : loading ? <Skeleton className="h-40" /> : items.length === 0 ? <EmptyState message="No messages." /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Created</TableHead><TableHead>Customer</TableHead><TableHead>To</TableHead><TableHead>About</TableHead>
                <TableHead>Message</TableHead><TableHead>Status</TableHead><TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {items.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-xs">{new Date(m.createdAt).toLocaleString()}<div className="text-muted-foreground">{m.triggerSource === 'manual' ? 'Manual' : 'Automatic'}</div></TableCell>
                    <TableCell>{m.customer?.name ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{m.to_masked ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{m.sale ? `${m.sale.referenceNo}${m.installment ? ` #${m.installment.installmentNo}` : ''}` : '—'}</TableCell>
                    <TableCell className="max-w-md text-sm"><p className="line-clamp-2">{m.renderedBody}</p><span className="text-xs text-muted-foreground">{m.segments ?? '?'} SMS · {m.encoding === 'ucs2' ? 'Unicode' : 'Standard'}</span></TableCell>
                    <TableCell>
                      <SmsStatusBadge status={m.status} />
                      {m.lastErrorCode && <div className="mt-1 text-xs text-muted-foreground">{SKIP_REASONS[m.lastErrorCode] ?? m.lastErrorCode}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {m.status === 'unknown' && can('communication.sms_provider.manage.company') && (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" disabled={resolving === m.id} onClick={() => resolve(m.id, 'sent')}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />It was sent</Button>
                          <Button size="sm" variant="outline" disabled={resolving === m.id} onClick={() => resolve(m.id, 'not_sent')}><XCircle className="mr-1 h-3.5 w-3.5" />Not sent</Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {cursor && <div className="mt-4 flex justify-center"><Button variant="outline" onClick={() => load(cursor)}>Load more</Button></div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Account() {
  const [account, setAccount] = useState<{ configured: boolean; senderName?: string | null; active?: boolean; unreadable?: boolean } | null>(null);
  const [userName, setUserName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [sender, setSender] = useState('');
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const r = await apiFetch('/api/v1/communications/sms-account');
    if (r.ok) setAccount(await r.json());
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await apiFetch('/api/v1/communications/sms-account', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey('sms-account') },
        body: JSON.stringify({ user_name: userName, api_key: apiKey, sender_name: sender }),
      });
      if (!r.ok) throw new Error(await readError(r));
      setAccount(await r.json());
      setApiKey('');
      toast.success('SMS account saved');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save the account'); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />MiMSMS account</CardTitle>
        <CardDescription>
          {account?.unreadable ? <strong className="text-destructive">The saved account cannot be read on this server (the encryption key changed). Enter it again; nothing is sent until you do.</strong> : account?.configured ? <>Configured. Sender ID <strong>{account.senderName}</strong>. The API key is stored encrypted and cannot be shown; enter it again to change it.</> : 'Not configured. Reminders cannot be sent until it is.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert><AlertDescription>
          In the MiMSMS panel (sms.mimsms.com → Utility → Developer): activate the API key, and whitelist this server&apos;s public IP address and domain. Use a Sender ID listed under Utility → Sender ID.
        </AlertDescription></Alert>
        <form className="grid gap-4 md:grid-cols-3" onSubmit={save} autoComplete="off">
          <div className="space-y-1"><Label htmlFor="mim-user">Panel login email</Label><Input id="mim-user" type="email" value={userName} onChange={e => setUserName(e.target.value)} required /></div>
          <div className="space-y-1"><Label htmlFor="mim-key">API key</Label><Input id="mim-key" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} required autoComplete="new-password" /></div>
          <div className="space-y-1"><Label htmlFor="mim-sender">Sender ID</Label><Input id="mim-sender" value={sender} onChange={e => setSender(e.target.value)} required maxLength={20} /></div>
          <div className="md:col-span-3"><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save account</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

interface Policy {
  enabled: boolean; stage_offsets: number[]; send_window_start_minute: number; send_window_end_minute: number;
  min_outstanding: string; max_per_customer_per_day: number; daily_company_limit: number; locale: 'bn' | 'en';
}

function PolicyForm() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [stages, setStages] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void apiFetch('/api/v1/communications/reminder-policy').then(async r => {
      if (!r.ok) return;
      const p = await r.json();
      setPolicy(p); setStages(p.stage_offsets.join(', '));
    });
  }, []);
  if (!policy) return <Skeleton className="h-64" />;

  const set = <K extends keyof Policy>(key: K, value: Policy[K]) => setPolicy({ ...policy, [key]: value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const offsets = stages.split(/[,\s]+/).filter(Boolean).map(Number);
    if (offsets.some(n => !Number.isInteger(n))) { toast.error('Stages are whole numbers of days, e.g. -3, 0, 7'); return; }
    setSaving(true);
    try {
      const r = await apiFetch('/api/v1/communications/reminder-policy', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey('reminder-policy') },
        body: JSON.stringify({ ...policy, stage_offsets: offsets }),
      });
      if (!r.ok) throw new Error(await readError(r));
      const saved = await r.json();
      setPolicy(saved); setStages(saved.stage_offsets.join(', '));
      toast.success('Reminder policy saved');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save the policy'); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Automatic reminders</CardTitle>
        <CardDescription>Sent for every credit sale with reminders on, at each stage, in the company&apos;s local time. Each is re-checked just before sending: paid customers get nothing, part-paid customers get the amount still owed.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={save}>
          <label className="flex items-center gap-3 md:col-span-2">
            <Switch checked={policy.enabled} onCheckedChange={v => set('enabled', v)} />
            <span className="font-medium">{policy.enabled ? 'On' : 'Off'}</span>
          </label>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="policy-stages">Stages (days from the due date)</Label>
            <Input id="policy-stages" value={stages} onChange={e => setStages(e.target.value)} />
            <p className="text-xs text-muted-foreground">Negative is before the due date, 0 is on it, positive is overdue. Example: -3, -1, 0, 1, 3, 7.</p>
          </div>
          <div className="space-y-1"><Label htmlFor="policy-from">Send from</Label><Input id="policy-from" type="time" value={hhmm(policy.send_window_start_minute)} onChange={e => set('send_window_start_minute', minuteOf(e.target.value))} /></div>
          <div className="space-y-1"><Label htmlFor="policy-to">Send until</Label><Input id="policy-to" type="time" value={hhmm(policy.send_window_end_minute % 1440)} onChange={e => set('send_window_end_minute', minuteOf(e.target.value) || 1440)} /></div>
          <div className="space-y-1"><Label htmlFor="policy-min">Minimum amount owed (৳)</Label><Input id="policy-min" inputMode="decimal" value={policy.min_outstanding} onChange={e => set('min_outstanding', e.target.value.trim())} /></div>
          <div className="space-y-1">
            <Label htmlFor="policy-locale">Language</Label>
            <Select value={policy.locale} onValueChange={v => set('locale', v as 'bn' | 'en')}>
              <SelectTrigger id="policy-locale"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="bn">বাংলা</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label htmlFor="policy-per-customer">Most reminders per customer per day</Label><Input id="policy-per-customer" type="number" min={1} max={10} value={policy.max_per_customer_per_day} onChange={e => set('max_per_customer_per_day', Number(e.target.value))} /></div>
          <div className="space-y-1"><Label htmlFor="policy-daily">Most SMS per day for the company</Label><Input id="policy-daily" type="number" min={0} max={100000} value={policy.daily_company_limit} onChange={e => set('daily_company_limit', Number(e.target.value))} /></div>
          <div className="md:col-span-2"><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save policy</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function Workspace() {
  const params = useSearchParams();
  const can = useCan();
  const [tab, setTab] = useState(params.get('tab') ?? 'overview');
  const [overview, setOverview] = useState<{ sms_today: Record<string, number>; sms_needing_attention_7_days: Record<string, number> } | null>(null);
  useEffect(() => {
    void apiFetch('/api/v1/collections/overview').then(async r => { if (r.ok) setOverview(await r.json()); });
  }, []);
  const manage = can('communication.sms_provider.manage.company');
  const policy = can('communication.reminder_policy.manage.company');
  const texts = can('communication.template.manage.company');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SMS &amp; Reminders</h1>
        <p className="text-sm text-muted-foreground">Due reminders to customers, sent through your company&apos;s own MiMSMS account.</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          {texts && <TabsTrigger value="texts">Texts</TabsTrigger>}
          {(manage || policy) && <TabsTrigger value="settings">Settings</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
          {!overview ? <Skeleton className="h-32" /> : (
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {([['Waiting', 'queued'], ['Sent', 'sent'], ['Delivered', 'delivered'], ['Failed', 'failed'], ['Unknown', 'unknown'], ['Not sent (checks)', 'skipped']] as const).map(([label, key]) => (
                <Card key={key}><CardHeader className="pb-2"><CardDescription>{label} today</CardDescription><CardTitle className={`text-2xl ${(key === 'failed' || key === 'unknown') && overview.sms_today[key] ? 'text-destructive' : ''}`}>{overview.sms_today[key]}</CardTitle></CardHeader></Card>
              ))}
            </div>
          )}
          {overview && overview.sms_needing_attention_7_days.unknown > 0 && (
            <Alert variant="destructive"><AlertDescription>
              {overview.sms_needing_attention_7_days.unknown} message(s) in the last 7 days have an unknown outcome and need checking. Open History and filter by “unknown”.
            </AlertDescription></Alert>
          )}
        </TabsContent>
        <TabsContent value="history"><History initialStatus={params.get('status') ?? 'all'} /></TabsContent>
        {texts && <TabsContent value="texts"><TemplateEditor /></TabsContent>}
        {(manage || policy) && (
          <TabsContent value="settings" className="space-y-6">
            {manage && <Account />}
            {policy && <PolicyForm />}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export default function SmsWorkspacePage() {
  return <Suspense fallback={<Skeleton className="h-64" />}><Workspace /></Suspense>;
}
