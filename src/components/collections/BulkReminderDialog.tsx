// Bulk due reminders: preview who the selection reaches and why the others
// would not, then confirm. The server queues only the set it previewed (the
// confirmation token); if anything changed it refuses and we preview again.
// Consumes: POST /api/v1/collections/bulk-reminders/preview, POST /api/v1/collections/bulk-reminders.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { newIdempotencyKey, readError } from './common';
import { apiFetch } from '@/lib/api/client';

interface Preview {
  selected: number; eligible: number; missing_phone: number; invalid_phone: number; already_paid: number;
  opted_out: number; duplicate_suppressed: number; not_sendable: number; not_found: number;
  segments_total: number; daily_limit_remaining: number; sample: { customer_name: string; text: string; segments: number } | null;
  confirmation_token: string;
}

const LINES: Array<[keyof Preview, string]> = [
  ['missing_phone', 'No mobile number'], ['invalid_phone', 'Invalid mobile number'], ['already_paid', 'Already paid'],
  ['opted_out', 'Opted out of SMS'], ['duplicate_suppressed', 'Duplicate (same customer, or already reminded today)'],
  ['not_sendable', 'Cannot be sent now (sale closed or cancelled)'], ['not_found', 'No longer available'],
];

export function BulkReminderDialog({ installmentIds, open, onOpenChange, onSent }: {
  installmentIds: string[]; open: boolean; onOpenChange: (open: boolean) => void; onSent: () => void;
}) {
  const [locale, setLocale] = useState<'bn' | 'en'>('bn');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // One key per dialog opening: a double click cannot queue the batch twice.
  const sendKey = useMemo(() => newIdempotencyKey('bulk-reminder'), [open, installmentIds, locale]);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setPreview(null);
    try {
      const r = await apiFetch('/api/v1/collections/bulk-reminders/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey('bulk-preview') },
        body: JSON.stringify({ installment_ids: installmentIds, locale }),
      });
      if (!r.ok) throw new Error(await readError(r));
      setPreview(await r.json());
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not prepare the preview'); }
    finally { setLoading(false); }
  }, [installmentIds, locale]);
  useEffect(() => { if (open && installmentIds.length) void load(); }, [open, installmentIds, load]);

  async function send() {
    if (!preview) return;
    setSending(true);
    try {
      const r = await apiFetch('/api/v1/collections/bulk-reminders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': sendKey },
        body: JSON.stringify({ installment_ids: installmentIds, locale, confirmation_token: preview.confirmation_token }),
      });
      if (r.status === 409) {
        toast.error(await readError(r));
        void load();
        return;
      }
      if (!r.ok) throw new Error(await readError(r));
      const data = await r.json();
      toast.success(`${data.queued} reminder(s) queued. They are sent within the sending hours, each re-checked first.`);
      onOpenChange(false);
      onSent();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not queue the reminders'); }
    finally { setSending(false); }
  }

  const overLimit = preview ? preview.eligible > preview.daily_limit_remaining : false;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send reminders to {installmentIds.length} selected</DialogTitle>
          <DialogDescription>Check who will receive a reminder before sending.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="bulk-language">Language</Label>
          <Select value={locale} onValueChange={v => setLocale(v as 'bn' | 'en')}>
            <SelectTrigger id="bulk-language" className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="bn">বাংলা</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
          </Select>
        </div>
        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking the selection…</div>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {preview && (
          <div className="space-y-3 text-sm">
            <p className="text-base"><strong>{preview.eligible}</strong> of {preview.selected} will receive a reminder
              ({preview.segments_total} SMS {preview.segments_total === 1 ? 'part' : 'parts'}).</p>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1">
              {LINES.filter(([key]) => Number(preview[key]) > 0).map(([key, label]) => (
                <div key={key} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="text-right tabular-nums">{String(preview[key])}</dd></div>
              ))}
              <dt className="text-muted-foreground">SMS left today (daily limit)</dt><dd className="text-right tabular-nums">{preview.daily_limit_remaining}</dd>
            </dl>
            {overLimit && <Alert variant="destructive"><AlertDescription>More than today&apos;s remaining limit. Select fewer, or raise the daily limit in SMS settings.</AlertDescription></Alert>}
            {preview.sample && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Example, for {preview.sample.customer_name}:</p>
                <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3" lang={locale}>{preview.sample.text}</p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={send} disabled={!preview || preview.eligible === 0 || overLimit || sending}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send {preview?.eligible ?? ''} reminder{preview?.eligible === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
