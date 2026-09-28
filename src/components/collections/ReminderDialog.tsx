// Manual due reminder: preview from the server, then queue.
// The worker sends it within the company's sending window, re-checking the
// balance first; the text is re-rendered with the amount owed at that moment.

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiFetch } from '@/lib/api/client';
import { newIdempotencyKey, readError, SKIP_REASONS, Taka, useCan } from './common';

interface Preview {
  customer_name: string; to_masked: string | null; phone_status: string; invoice_no: string; installment_no: number;
  due_date: string; outstanding: string; text: string | null; encoding: 'gsm7' | 'ucs2' | null; segments: number; blocked: string | null;
}

export function ReminderDialog({ installmentId, open, onOpenChange, onSent }: {
  installmentId: string | null; open: boolean; onOpenChange: (open: boolean) => void; onSent?: () => void;
}) {
  const can = useCan();
  const [locale, setLocale] = useState<'bn' | 'en'>('bn');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // One key per dialog: a double click cannot queue two reminders.
  const idempotencyKey = useMemo(() => newIdempotencyKey('manual-reminder'), [installmentId, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !installmentId) return;
    let cancelled = false;
    setLoading(true); setError(null); setPreview(null);
    apiFetch(`/api/v1/collections/installments/${installmentId}/reminder?locale=${locale}`)
      .then(async r => { if (!r.ok) throw new Error(await readError(r)); return r.json(); })
      .then(p => { if (!cancelled) setPreview(p); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the preview'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, installmentId, locale]);

  async function send() {
    if (!installmentId) return;
    setSending(true);
    try {
      const r = await apiFetch(`/api/v1/collections/installments/${installmentId}/reminder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ locale }),
      });
      if (!r.ok) throw new Error(await readError(r));
      toast.success('Reminder queued. It is sent within the sending hours, with the amount owed at that moment.');
      onOpenChange(false);
      onSent?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not queue the reminder');
    } finally {
      setSending(false);
    }
  }

  const canSend = can('communication.transactional.send.branch');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send a due reminder</DialogTitle>
          <DialogDescription>Check the recipient and the message before sending.</DialogDescription>
        </DialogHeader>
        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Preparing the preview…</div>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {preview && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
              <dt className="text-muted-foreground">Customer</dt><dd>{preview.customer_name}</dd>
              <dt className="text-muted-foreground">Mobile</dt><dd className="font-mono">{preview.to_masked ?? '—'}</dd>
              <dt className="text-muted-foreground">Invoice</dt><dd>{preview.invoice_no} · installment {preview.installment_no}</dd>
              <dt className="text-muted-foreground">Due date</dt><dd>{preview.due_date}</dd>
              <dt className="text-muted-foreground">Owed now</dt><dd><Taka value={preview.outstanding} /></dd>
            </dl>
            <div className="space-y-1">
              <Label htmlFor="reminder-language">Language</Label>
              <Select value={locale} onValueChange={v => setLocale(v as 'bn' | 'en')}>
                <SelectTrigger id="reminder-language" className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="bn">বাংলা</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
              </Select>
            </div>
            {preview.blocked ? (
              <Alert variant="destructive"><AlertDescription>Cannot send: {SKIP_REASONS[preview.blocked] ?? preview.blocked}.</AlertDescription></Alert>
            ) : (
              <div className="space-y-1">
                <p className="rounded-md border bg-muted/40 p-3 whitespace-pre-wrap" lang={locale}>{preview.text}</p>
                <p className="text-xs text-muted-foreground">
                  {preview.encoding === 'ucs2' ? 'Unicode (Bangla)' : 'Standard'} · {preview.text?.length ?? 0} characters · {preview.segments} SMS {preview.segments === 1 ? 'part' : 'parts'}
                </p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canSend && (
            <Button onClick={send} disabled={!preview || Boolean(preview.blocked) || sending}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Send reminder
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
