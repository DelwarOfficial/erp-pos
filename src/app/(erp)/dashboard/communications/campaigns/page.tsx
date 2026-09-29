// src/app/(erp)/dashboard/communications/campaigns/page.tsx
// Marketing SMS campaigns: write a draft, preview who it reaches (only
// customers who agreed to marketing SMS), send, follow progress, cancel.
// Consumes: GET|POST /api/v1/communications/campaigns,
//           POST /api/v1/communications/campaigns/{id}/preview|send|cancel.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Megaphone, RefreshCw, Send, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, EmptyState } from '@/components/shared/StateList';
import { apiFetch } from '@/lib/api/client';
import { newIdempotencyKey, readError, useCan } from '@/components/collections/common';
import { smsSegments } from '@/domain/receivables/smsSegments';

interface Campaign {
  id: string; name: string; status: string; locale: 'bn' | 'en'; text: string; customer_group: { id: string; name: string } | null;
  created_by: string; approved_by: string | null; created_at: string; started_at: string | null; completed_at: string | null;
  messages: Record<string, number>; skipped: number;
}
interface Preview {
  matched: number; eligible: number; no_marketing_consent: number; missing_phone: number; invalid_phone: number; duplicate_phone: number;
  segments_each: number; segments_total: number; daily_limit_remaining: number; sample: string | null; confirmation_token: string;
}
const STATUS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = { draft: 'outline', running: 'secondary', completed: 'default', cancelled: 'outline', failed: 'destructive' };

async function post(url: string, body: unknown, prefix: string) {
  const r = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey(prefix) }, body: JSON.stringify(body) });
  if (!r.ok) throw Object.assign(new Error(await readError(r)), { status: r.status });
  return r.json();
}

export default function CampaignsPage() {
  const can = useCan();
  const [data, setData] = useState<{ items: Campaign[]; groups: Array<{ id: string; name: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [locale, setLocale] = useState<'bn' | 'en'>('bn');
  const [group, setGroup] = useState('all');
  const [saving, setSaving] = useState(false);
  const [sendFor, setSendFor] = useState<Campaign | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await apiFetch('/api/v1/communications/campaigns');
      if (!r.ok) throw new Error(await readError(r));
      setData(await r.json());
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load campaigns'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadPreview = useCallback(async (campaign: Campaign) => {
    setPreview(null); setPreviewError(null);
    try { setPreview(await post(`/api/v1/communications/campaigns/${campaign.id}/preview`, {}, 'campaign-preview')); }
    catch (e) { setPreviewError(e instanceof Error ? e.message : 'Could not prepare the preview'); }
  }, []);
  useEffect(() => { if (sendFor) void loadPreview(sendFor); }, [sendFor, loadPreview]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await post('/api/v1/communications/campaigns', { name, text, locale, customer_group_id: group === 'all' ? undefined : group }, 'campaign-create');
      toast.success('Draft saved. Preview it to see who it reaches.');
      setName(''); setText('');
      void load();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save'); }
    finally { setSaving(false); }
  }
  async function send() {
    if (!sendFor || !preview) return;
    setSending(true);
    try {
      const result = await post(`/api/v1/communications/campaigns/${sendFor.id}/send`, { confirmation_token: preview.confirmation_token }, 'campaign-send');
      toast.success(`${result.queued} SMS queued. They go out within the sending hours.`);
      setSendFor(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send');
      if ((err as { status?: number }).status === 409 && sendFor) void loadPreview(sendFor);
    } finally { setSending(false); }
  }
  async function cancel(c: Campaign) {
    if (!window.confirm(`Cancel "${c.name}"? Messages not yet sent will not be sent.`)) return;
    try { await post(`/api/v1/communications/campaigns/${c.id}/cancel`, {}, 'campaign-cancel'); void load(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not cancel'); }
  }

  const draft = text.trim() ? smsSegments(text.replace(/\{\{\s*customer_name\s*\}\}/g, 'Customer Name').replace(/\{\{\s*company_name\s*\}\}/g, 'Company')) : null;
  const canSend = can('communication.campaign.send');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Megaphone className="h-6 w-6" />SMS campaigns</h1>
          <p className="text-sm text-muted-foreground">Marketing SMS go only to customers who agreed to receive them (set on each customer&apos;s profile), as promotional messages: the network does not deliver them to numbers on Do Not Disturb.</p>
        </div>
        <Button variant="outline" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>New campaign</CardTitle><CardDescription>Saved as a draft. Nothing is sent until you preview and confirm.</CardDescription></CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-3" onSubmit={create}>
            <div className="space-y-1"><Label htmlFor="c-name">Name</Label><Input id="c-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} required /></div>
            <div className="space-y-1">
              <Label htmlFor="c-group">Who</Label>
              <Select value={group} onValueChange={setGroup}>
                <SelectTrigger id="c-group"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All customers who agreed</SelectItem>
                  {data?.groups.map(g => <SelectItem key={g.id} value={g.id}>Group: {g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-locale">Language</Label>
              <Select value={locale} onValueChange={v => setLocale(v as 'bn' | 'en')}>
                <SelectTrigger id="c-locale"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="bn">বাংলা</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-3">
              <Label htmlFor="c-text">Message</Label>
              <Textarea id="c-text" rows={3} value={text} onChange={e => setText(e.target.value)} maxLength={700} lang={locale} required />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {['customer_name', 'company_name'].map(p => (
                  <Button key={p} type="button" size="sm" variant="outline" className="h-6 px-2 font-mono text-xs" onClick={() => setText(t => `${t}{{${p}}}`)}>{`{{${p}}}`}</Button>
                ))}
                {draft && <span>{draft.encoding === 'ucs2' ? 'Unicode' : 'Standard'} · about {draft.segments} SMS {draft.segments === 1 ? 'part' : 'parts'} each</span>}
              </div>
            </div>
            <div><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save draft</Button></div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Campaigns</CardTitle></CardHeader>
        <CardContent>
          {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Skeleton className="h-32" /> : data.items.length === 0 ? <EmptyState message="No campaigns yet." /> : (
            <ul className="divide-y">
              {data.items.map(c => {
                const m = c.messages;
                const done = (m.sent ?? 0) + (m.delivered ?? 0);
                return (
                  <li key={c.id} className="space-y-1 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      <Badge variant={STATUS[c.status] ?? 'outline'}>{c.status}</Badge>
                      <span className="text-xs text-muted-foreground">{c.customer_group ? `Group: ${c.customer_group.name}` : 'All who agreed'} · {c.locale === 'bn' ? 'বাংলা' : 'English'} · by {c.created_by}{c.approved_by ? `, sent by ${c.approved_by}` : ''}</span>
                      <span className="ml-auto flex gap-2">
                        {c.status === 'draft' && canSend && <Button size="sm" onClick={() => setSendFor(c)}><Send className="mr-1 h-3.5 w-3.5" />Preview &amp; send</Button>}
                        {(c.status === 'draft' || c.status === 'running') && <Button size="sm" variant="ghost" onClick={() => cancel(c)}><XCircle className="mr-1 h-3.5 w-3.5" />Cancel</Button>}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground" lang={c.locale}>{c.text}</p>
                    {c.status !== 'draft' && (
                      <p className="text-xs text-muted-foreground">
                        {done} sent ({m.delivered ?? 0} delivered) · {(m.queued ?? 0) + (m.sending ?? 0)} waiting · {m.failed ?? 0} failed · {m.unknown ?? 0} unknown · {(m.skipped ?? 0) + (m.cancelled ?? 0)} stopped · {c.skipped} not eligible
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={sendFor !== null} onOpenChange={open => { if (!open) setSendFor(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send “{sendFor?.name}”</DialogTitle>
            <DialogDescription>Check who will receive it. Sending cannot be undone for messages already delivered.</DialogDescription>
          </DialogHeader>
          {previewError && <Alert variant="destructive"><AlertDescription>{previewError}</AlertDescription></Alert>}
          {!preview && !previewError && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking the audience…</div>}
          {preview && (
            <div className="space-y-3 text-sm">
              <p className="text-base"><strong>{preview.eligible}</strong> of {preview.matched} customers will receive it ({preview.segments_total} SMS parts).</p>
              <dl className="grid grid-cols-[1fr_auto] gap-y-1">
                <dt className="text-muted-foreground">Did not agree to marketing SMS</dt><dd className="text-right">{preview.no_marketing_consent}</dd>
                <dt className="text-muted-foreground">No mobile / invalid mobile</dt><dd className="text-right">{preview.missing_phone} / {preview.invalid_phone}</dd>
                <dt className="text-muted-foreground">Same number as another customer</dt><dd className="text-right">{preview.duplicate_phone}</dd>
                <dt className="text-muted-foreground">SMS left today (daily limit)</dt><dd className="text-right">{preview.daily_limit_remaining}</dd>
              </dl>
              {preview.eligible > preview.daily_limit_remaining && <Alert variant="destructive"><AlertDescription>More than today&apos;s remaining limit: raise the daily limit in SMS settings, or send tomorrow.</AlertDescription></Alert>}
              {preview.sample && <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3" lang={sendFor?.locale}>{preview.sample}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendFor(null)}>Close</Button>
            <Button onClick={send} disabled={!preview || preview.eligible === 0 || preview.eligible > preview.daily_limit_remaining || sending}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send to {preview?.eligible ?? 0}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
