// src/app/(erp)/dashboard/cashier/page.tsx
// Cashier shift management — open/close.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Loader2, Clock, CircleDot, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';
import { PageHeader } from '@/components/shared/PageHeader';
import { useFormat } from '@/components/i18n/I18nProvider';
import { apiFetch } from '@/lib/api/client';
import { EntityPicker, type BusinessEntity } from '@/components/shared/EntityPicker';

interface Shift {
  id: string;
  status: string;
  cashier: { id: string; name: string; email: string };
  branch: { id: string; name: string; code: string };
  opened_at: string;
  closed_at: string | null;
  opening_float: string;
  expected_closing_cash: string | null;
  counted_closing_cash: string | null;
  variance: string | null;
  variance_reason: string | null;
  sale_count: number;
  payment_count: number;
}

export default function CashierPage() {
  const t = useTranslations('cashier');
  const f = useFormat();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState({ branchId: '', warehouseId: '', cashAccountId: '', openingFloat: '0' });
  const [closeForm, setCloseForm] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<Shift | null>(null);
  const [floatError, setFloatError] = useState<string | null>(null);
  const [warehouse, setWarehouse] = useState<BusinessEntity | null>(null);
  const [account, setAccount] = useState<BusinessEntity | null>(null);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/cashier-shifts?limit=20');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? t('load_failed'));
      setShifts(data.items ?? []);
    } catch (e) {
      const msg = e instanceof Error && e.message && !(e instanceof TypeError) ? e.message : t('load_failed');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadShifts(); }, [loadShifts]);

  async function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouse?.branch || !account) { toast.error(t('open_missing')); return; }
    const float = Number(openForm.openingFloat);
    if (openForm.openingFloat === '' || !Number.isFinite(float) || float < 0) { setFloatError(t('open_float_invalid')); return; }
    setFloatError(null);
    setOpening(true);
    try {
      const idempotencyKey = `shift-open-${Date.now()}`;
      const res = await apiFetch('/api/v1/cashier-shifts/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          branch_id: warehouse.branch.id,
          warehouse_id: warehouse.id,
          cash_account_id: account.id,
          opening_float: float,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(t('open_failed', { reason: data?.error?.message ?? t('generic_reason') })); return; }
      toast.success(t('opened'));
      setOpenForm({ branchId: '', warehouseId: '', cashAccountId: '', openingFloat: '0' });
      setWarehouse(null); setAccount(null);
      await loadShifts();
    } catch { toast.error(t('network')); }
    finally { setOpening(false); }
  }

  function askClose(shift: Shift) {
    const counted = closeForm[shift.id];
    if (!counted || !Number.isFinite(Number(counted)) || Number(counted) < 0) { toast.error(t('close_missing')); return; }
    setConfirmClose(shift);
  }

  async function handleClose(shiftId: string) {
    const counted = closeForm[shiftId];
    if (!counted) { toast.error(t('close_missing')); return; }
    setClosingId(shiftId);
    try {
      const idempotencyKey = `shift-close-${shiftId}-${Date.now()}`;
      const res = await apiFetch(`/api/v1/cashier-shifts/${shiftId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ counted_closing_cash: Number(counted) }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(t('close_failed', { reason: data?.error?.message ?? t('generic_reason') })); return; }
      const variance = Number(data.variance);
      if (!Number.isFinite(variance) || variance === 0) toast.success(t('closed_even'));
      else if (variance < 0) toast.warning(t('closed_short', { amount: f.money(-variance) }));
      else toast.warning(t('closed_over', { amount: f.money(variance) }));
      await loadShifts();
    } catch { toast.error(t('network')); }
    finally { setClosingId(null); }
  }

  function statusLabel(status: string) {
    return status === 'open' ? t('status_open') : status === 'closed' ? t('status_closed') : status === 'approved' ? t('status_approved') : status;
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={<Clock className="h-6 w-6" aria-hidden="true" />} title={t('title')} description={t('subtitle')} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base"><h2>{t('open_title')}</h2></CardTitle>
          <CardDescription>{t('open_help')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleOpen} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" noValidate aria-busy={opening}>
            <div><EntityPicker label={t('warehouse')} endpoint="/api/v1/warehouses" serverSearch={false} value={warehouse} disabled={opening} onChange={value => { setWarehouse(value); setAccount(null); }} />{warehouse?.branch && <p className="mt-1 text-xs text-muted-foreground">{t('branch', { name: warehouse.branch.name })}</p>}</div>
            <EntityPicker key={warehouse?.id ?? 'none'} label={t('cash_account')} endpoint={`/api/v1/financial-accounts?is_active=true&account_type=cash${warehouse?.branch ? `&branch_id=${warehouse.branch.id}` : ''}`} serverSearch={false} value={account} onChange={setAccount} disabled={opening || !warehouse} />
            <div className="space-y-1.5">
              <Label htmlFor="field-app-erp-dashboard-cashier-page-4">{t('opening_float')}</Label>
              <Input id="field-app-erp-dashboard-cashier-page-4" type="number" inputMode="decimal" min="0" step="0.01" value={openForm.openingFloat}
                onChange={e => { setOpenForm({ ...openForm, openingFloat: e.target.value }); setFloatError(null); }} required aria-required="true"
                aria-invalid={!!floatError} aria-describedby="opening-float-help" className="min-h-11 tabular-nums" />
              <p id="opening-float-help" role={floatError ? 'alert' : undefined} className={`text-xs ${floatError ? 'text-destructive' : 'text-muted-foreground'}`}>{floatError ?? t('opening_float_help')}</p>
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" size="lg" disabled={opening} className="min-h-12">
                {opening ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                {opening ? t('opening') : t('open_submit')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base"><h2>{t('list_title', { count: shifts.length })}</h2></CardTitle>
          {!loading && !error && <Button type="button" size="sm" variant="ghost" onClick={loadShifts}>{t('refresh')}</Button>}
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingState label={t('loading')} />
          ) : error ? (
            <ErrorState message={error} onRetry={loadShifts} />
          ) : shifts.length === 0 ? (
            <EmptyState
              icon={<Clock className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />}
              message={t('empty')}
            />
          ) : (
            <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {shifts.map(s => {
                const variance = s.variance === null ? null : Number(s.variance);
                return (
                <li key={s.id} className="border rounded-md p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={s.status === 'open' ? 'default' : 'secondary'} className="gap-1">
                        {s.status === 'open' ? <CircleDot className="size-3" aria-hidden="true" /> : <Lock className="size-3" aria-hidden="true" />}
                        {statusLabel(s.status)}
                      </Badge>
                      <span className="font-medium">{s.cashier.name}</span>
                      <span className="text-sm text-muted-foreground">{s.branch.name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {t('opened_at', { when: f.dateTime(s.opened_at) })}
                      {s.closed_at && ` · ${t('closed_at', { when: f.dateTime(s.closed_at) })}`}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-1.5 tabular-nums">
                      <span>{t('float')}: {f.money(s.opening_float)}</span>
                      {s.expected_closing_cash && <span>{t('expected')}: {f.money(s.expected_closing_cash)}</span>}
                      {s.counted_closing_cash && <span>{t('counted')}: {f.money(s.counted_closing_cash)}</span>}
                      {variance !== null && Number.isFinite(variance) && (
                        <span className={variance < 0 ? 'font-medium text-destructive' : 'font-medium'}>
                          {variance === 0 ? t('diff_even') : variance < 0 ? t('diff_short', { amount: f.money(-variance) }) : t('diff_over', { amount: f.money(variance) })}
                        </span>
                      )}
                      <span className="text-muted-foreground">{t('sales', { count: s.sale_count })}</span>
                      <span className="text-muted-foreground">{t('payments', { count: s.payment_count })}</span>
                    </div>
                  </div>
                  {s.status === 'open' && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder={t('counted_placeholder')}
                        value={closeForm[s.id] ?? ''}
                        onChange={e => setCloseForm({ ...closeForm, [s.id]: e.target.value })}
                        className="w-40 min-h-11 tabular-nums"
                        aria-label={t('counted_label', { name: s.cashier.name })}
                        disabled={closingId === s.id}
                      />
                      <Button type="button" onClick={() => askClose(s)} disabled={closingId === s.id} className="min-h-11">
                        {closingId === s.id ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Lock aria-hidden="true" />}
                        {closingId === s.id ? t('closing') : t('close')}
                      </Button>
                    </div>
                  )}
                </li>
              ); })}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmClose} onOpenChange={open => { if (!open) setConfirmClose(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmClose ? t('close_title', { name: confirmClose.cashier.name }) : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmClose ? t('close_body', { amount: f.money(closeForm[confirmClose.id]) }) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('close_keep')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmClose) void handleClose(confirmClose.id); }}>{t('close_confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
