// A customer's SMS choices: due reminders (sent unless withdrawn) and
// marketing SMS (only with explicit agreement). Each change is appended to the
// consent history. Consumes: GET|PUT /api/v1/customers/{id}/sms-preferences.

'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { apiFetch } from '@/lib/api/client';
import { newIdempotencyKey, readError, useCan } from './common';

interface Prefs { reminders: 'allowed' | 'withdrawn'; marketing: 'granted' | 'withdrawn' | 'not_asked' }

export function SmsPreferences({ customerId }: { customerId: string }) {
  const can = useCan();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void apiFetch(`/api/v1/customers/${customerId}/sms-preferences`).then(async r => { if (r.ok) setPrefs(await r.json()); });
  }, [customerId]);

  async function change(patch: Partial<{ reminders: Prefs['reminders']; marketing: 'granted' | 'withdrawn' }>) {
    setSaving(true);
    try {
      const r = await apiFetch(`/api/v1/customers/${customerId}/sms-preferences`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey('sms-prefs') },
        body: JSON.stringify({ ...patch, source: 'staff' }),
      });
      if (!r.ok) throw new Error(await readError(r));
      setPrefs(await r.json());
      toast.success('SMS preference recorded');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
    finally { setSaving(false); }
  }

  if (!prefs) return null;
  const editable = can('customer.update') && !saving;
  return (
    <Card>
      <CardHeader><CardTitle>SMS preferences</CardTitle><CardDescription>Record what the customer asked for. Every change is kept with who recorded it.</CardDescription></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <label className="flex items-center justify-between gap-4">
          <span><span className="font-medium">Due reminders</span><span className="block text-xs text-muted-foreground">Sent unless the customer asked to stop them.</span></span>
          <Switch checked={prefs.reminders === 'allowed'} disabled={!editable} onCheckedChange={v => change({ reminders: v ? 'allowed' : 'withdrawn' })} />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span><span className="font-medium">Marketing SMS</span><span className="block text-xs text-muted-foreground">{prefs.marketing === 'not_asked' ? 'Not asked yet: offers are not sent.' : 'Only with the customer\'s agreement.'}</span></span>
          <Switch checked={prefs.marketing === 'granted'} disabled={!editable} onCheckedChange={v => change({ marketing: v ? 'granted' : 'withdrawn' })} />
        </label>
      </CardContent>
    </Card>
  );
}
