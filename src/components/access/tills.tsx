'use client';

// Tills (registered offline-sale devices): list and revoke.
// Uses GET /api/v1/devices (device.read) and PATCH /api/v1/devices/{id}
// (device.revoke). The server checks both permissions, the company and the
// branch; hiding the controls here is only a convenience.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CloudOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { apiFetch } from '@/lib/api/client';
import { useFormat } from '@/components/i18n/I18nProvider';
import { useDashboardSession } from '@/components/dashboard/session';

interface Till {
  id: string; label: string; status: string; branch: { id: string; name: string } | null;
  registered_by: { id: string; name: string } | null;
  last_seen_at: string | null; last_bootstrap_at: string | null; created_at: string; revoked_at: string | null;
}

export function TillsPanel() {
  const t = useTranslations('tills');
  const f = useFormat();
  const session = useDashboardSession();
  const can = (p: string) => Boolean(session?.is_global || session?.permissions.includes(p) || session?.permissions.includes('*'));
  const canRead = can('device.read');
  const canRevoke = can('device.revoke');
  const [items, setItems] = useState<Till[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [target, setTarget] = useState<Till | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const key = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const response = await apiFetch('/api/v1/devices');
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? response.statusText);
      setItems(data.items ?? []);
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (canRead) void load(); }, [canRead, load]);

  if (!canRead) return null;

  async function revoke() {
    if (!target || saving || reason.trim().length < 3) return;
    setSaving(true); setSaveError('');
    // One key per attempt at this revoke, so a retry after a lost reply is safe.
    key.current ??= `till-revoke-${crypto.randomUUID()}`;
    try {
      const response = await apiFetch(`/api/v1/devices/${target.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key.current },
        body: JSON.stringify({ status: 'revoked', reason: reason.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? response.statusText);
      toast.success(t('revoked', { label: target.label }));
      key.current = null; setTarget(null); setReason('');
      await load();
    } catch (cause) { setSaveError(t('revoke_failed', { reason: cause instanceof Error ? cause.message : String(cause) })); }
    finally { setSaving(false); }
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><CloudOff className="h-5 w-5" aria-hidden="true" /><h2>{t('title')}</h2></CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('loading')}</p>
          : loadError ? (
            <div role="alert" className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm">
              <p>{t('load_failed', { reason: loadError })}</p>
              <Button type="button" variant="outline" onClick={() => void load()}>{t('retry')}</Button>
            </div>
          ) : items.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{t('empty')}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('title')}</caption>
                <thead className="text-left text-muted-foreground"><tr>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('col_till')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('col_branch')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('col_last_seen')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('col_status')}</th>
                  {canRevoke ? <th scope="col" className="py-2"><span className="sr-only">{t('col_action')}</span></th> : null}
                </tr></thead>
                <tbody>
                  {items.map(till => (
                    <tr key={till.id} className="border-t align-top">
                      <td className="py-2 pr-3"><div className="font-medium">{till.label}</div>
                        <div className="text-xs text-muted-foreground">{t('registered', { by: till.registered_by?.name ?? '—', when: f.date(till.created_at) })} · <code>{till.id.slice(0, 8)}</code></div></td>
                      <td className="py-2 pr-3">{till.branch?.name ?? '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{till.last_seen_at ? f.dateTime(till.last_seen_at) : '—'}</td>
                      <td className="py-2 pr-3"><Badge variant={till.status === 'active' ? 'default' : 'secondary'}>{t(till.status === 'revoked' ? 'status_revoked' : till.status === 'active' ? 'status_active' : 'status_pending')}</Badge>
                        {till.revoked_at ? <div className="text-xs text-muted-foreground">{f.dateTime(till.revoked_at)}</div> : null}</td>
                      {canRevoke ? (
                        <td className="py-2 text-right">
                          {till.status !== 'revoked'
                            ? <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={() => { setTarget(till); setReason(''); setSaveError(''); key.current = null; }}>{t('revoke', { label: till.label })}</Button>
                            : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </CardContent>

      <AlertDialog open={target !== null} onOpenChange={open => { if (!open && !saving) setTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{target ? t('confirm_title', { label: target.label }) : ''}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>{t('confirm_effect')}</p>
                <p className="font-medium text-foreground">{t('confirm_pending')}</p>
                <p>{t('confirm_sessions')}</p>
                <p>{t('confirm_final')}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="till-revoke-reason">{t('reason_label')}</Label>
            <textarea id="till-revoke-reason" required minLength={3} maxLength={300} rows={2} value={reason} disabled={saving}
              onChange={e => setReason(e.target.value)} aria-describedby="till-revoke-reason-hint"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" />
            <p id="till-revoke-reason-hint" className="text-xs text-muted-foreground">{t('reason_hint')}</p>
          </div>
          {saveError ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm">{saveError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t('cancel')}</AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={saving || reason.trim().length < 3} onClick={() => void revoke()}>
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('revoking')}</> : target ? t('confirm_button', { label: target.label }) : ''}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
