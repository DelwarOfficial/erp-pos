'use client';

// Offline cash sales on a registered till.
//
// OfflineTillPanel (online, on New Sale): set this browser up as a till, keep
// its product list fresh, and send sales taken offline — in order — as soon as
// the connection is back. Sales the server refused stay listed for a manager.
//
// OfflineSaleScreen (offline): cash sales from the saved product list. Every
// amount shown is the server's own line total for that quantity (tax included);
// nothing is priced or taxed here. No credit, card, wallet, gift card, points,
// coupons, line discounts or serial-numbered items while offline.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CloudOff, Loader2, Minus, Plus, RefreshCw, Trash2, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api/client';
import { useFormat } from '@/components/i18n/I18nProvider';
import {
  type Catalogue, type CatalogueProduct, type QueuedSale, type Till,
  getCatalogue, getTill, listSales, offlineLineTotal, queueCashSale, retrySale, saveCatalogue, saveTill, sendQueued, sumMoney,
} from '@/lib/offline/posQueue';
import { OFFLINE_MAX_QTY } from '@/lib/offline/syncLimits';

/** navigator.onLine, kept current. */
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return online;
}

/** The till, its product list and its queue, from this browser's store. */
function useTillState() {
  const [till, setTill] = useState<Till | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [sales, setSales] = useState<QueuedSale[]>([]);
  const [ready, setReady] = useState(false);
  const reload = useCallback(async () => {
    try {
      const [t, c, s] = await Promise.all([getTill(), getCatalogue(), listSales()]);
      setTill(t ?? null); setCatalogue(c ?? null); setSales(s);
    } catch { /* storage blocked (private window): the till can't work offline */ }
    finally { setReady(true); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { till, catalogue, sales, ready, reload };
}

async function fetchCatalogue(till: Till): Promise<Catalogue> {
  const response = await apiFetch('/api/v1/offline/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `bootstrap-${crypto.randomUUID()}` },
    body: JSON.stringify({ device_id: till.device_id, branch_id: till.branch_id }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? response.statusText);
  const catalogue = { products: data.snapshot.products, generated_at: data.snapshot.generated_at, expires_at: data.expires_at, signature: data.signature };
  await saveCatalogue(catalogue);
  return catalogue;
}

const syncSend = async (body: string, key: string) => {
  const response = await apiFetch('/api/v1/offline/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

export function OfflineTillPanel({ branchId, warehouseId, cashAccountId, canRegister }: { branchId: string; warehouseId: string; cashAccountId: string; canRegister: boolean }) {
  const t = useTranslations('offline');
  const f = useFormat();
  const online = useOnline();
  const { till, catalogue, sales, ready, reload } = useTillState();
  const [busy, setBusy] = useState<'' | 'setup' | 'refresh' | 'send'>('');
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [setupOpen, setSetupOpen] = useState(false);
  const sending = useRef(false);
  // The set-up card only shows where offline sales are switched on.
  const [flagOn, setFlagOn] = useState(false);
  useEffect(() => {
    if (!ready || till || !canRegister || !online) return;
    let active = true;
    void apiFetch('/api/v1/feature-flags').then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      if (active) setFlagOn(Boolean((data.items as Array<{ flagKey?: string; flag_key?: string; enabled: boolean }>)
        .find(flag => (flag.flagKey ?? flag.flag_key) === 'offline_pos_enabled')?.enabled));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [ready, till, canRegister, online]);

  const send = useCallback(async (quiet = false) => {
    if (!till || sending.current) return;
    sending.current = true; setBusy('send'); setError('');
    try {
      const result = await sendQueued(till, syncSend);
      if (result.sent) toast.success(t('sent', { count: result.sent }));
      if (result.needsAttention) toast.error(t('refused', { count: result.needsAttention }));
      if (result.stoppedOffline && !quiet) setError(t('send_stopped'));
    } finally { sending.current = false; setBusy(''); await reload(); }
  }, [till, reload, t]);

  const refresh = useCallback(async (quiet = false) => {
    if (!till) return;
    setBusy('refresh'); setError('');
    try { await fetchCatalogue(till); if (!quiet) toast.success(t('refreshed')); }
    catch (cause) { if (!quiet) setError(t('refresh_failed', { reason: cause instanceof Error ? cause.message : String(cause) })); }
    finally { setBusy(''); await reload(); }
  }, [till, reload, t]);

  // Back online (or the page opened with sales waiting): send them, then refresh prices.
  useEffect(() => {
    if (!online || !till) return;
    void (async () => {
      if (sales.some(s => s.status === 'queued')) await send(true);
      if (!catalogue || new Date(catalogue.expires_at).getTime() - Date.now() < 2 * 60 * 60 * 1000) await refresh(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, till?.device_id]);

  async function setup(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy('setup'); setError('');
    try {
      const deviceKey = crypto.randomUUID();
      const response = await apiFetch('/api/v1/devices', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `till-${deviceKey}` },
        body: JSON.stringify({ label: label.trim(), branch_id: branchId, device_key: deviceKey }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? response.statusText);
      const created: Till = { device_id: data.id, device_key: deviceKey, label: data.label, branch_id: branchId, warehouse_id: warehouseId, cash_account_id: cashAccountId, next_sequence: 1 };
      await saveTill(created);
      await fetchCatalogue(created);
      toast.success(t('setup_done'));
    } catch (cause) { setError(t('setup_failed', { reason: cause instanceof Error ? cause.message : String(cause) })); }
    finally { setBusy(''); await reload(); }
  }

  if (!ready) return null;
  const queued = sales.filter(s => s.status === 'queued');
  const attention = sales.filter(s => s.status === 'needs_attention');

  if (!till) {
    if (!canRegister || !flagOn) return null;
    const missing = !branchId || !warehouseId || !cashAccountId;
    // A quiet line until someone chooses to set the till up.
    if (!setupOpen) return (
      <section aria-labelledby="till-setup-compact" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed bg-card px-3 py-2 text-sm">
        <CloudOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 id="till-setup-compact" className="font-medium">{t('setup_title')}</h2>
        <span className="text-muted-foreground">{t('setup_short')}</span>
        <Button type="button" variant="outline" size="sm" className="ml-auto min-h-9" onClick={() => { setSetupOpen(true); setTimeout(() => document.getElementById('till-label')?.focus(), 0); }}>{t('setup_open')}</Button>
      </section>
    );
    return (
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CloudOff className="h-5 w-5" aria-hidden="true" /><h2>{t('setup_title')}</h2></CardTitle>
          <CardDescription>{t('setup_body')}</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={setup} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="till-label">{t('setup_label')}</Label>
              <Input id="till-label" required maxLength={80} className="h-11" value={label} onChange={e => setLabel(e.target.value)} aria-describedby="till-setup-hint" />
            </div>
            <Button type="submit" className="min-h-11" disabled={!!busy || missing || !label.trim()}>{busy === 'setup' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('setup_button')}</Button>
            <Button type="button" variant="ghost" className="min-h-11" disabled={!!busy} onClick={() => setSetupOpen(false)}>{t('setup_cancel')}</Button>
          </form>
          <p id="till-setup-hint" className="mt-2 text-sm text-muted-foreground">{missing ? t('setup_missing') : t('setup_hint')}</p>
          {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    );
  }

  // Nothing waiting and nothing wrong: one quiet line.
  if (!queued.length && !attention.length && !error) return (
    <section aria-labelledby="till-compact" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm">
      <CloudOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <h2 id="till-compact" className="font-medium">{t('panel_title', { label: till.label })}</h2>
      <span className="text-muted-foreground">{catalogue ? t('panel_products', { count: catalogue.products.length, when: f.dateTime(catalogue.generated_at) }) : t('panel_no_products')}</span>
      <span role="status" className="text-muted-foreground">{t('panel_nothing_queued')}</span>
      <Button type="button" variant="ghost" size="sm" className="ml-auto min-h-9" disabled={!!busy || !online} onClick={() => void refresh()}>
        {busy === 'refresh' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}{t('refresh')}</Button>
    </section>
  );

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><CloudOff className="h-5 w-5" aria-hidden="true" /><h2>{t('panel_title', { label: till.label })}</h2></CardTitle>
        <CardDescription>{catalogue ? t('panel_products', { count: catalogue.products.length, when: f.dateTime(catalogue.generated_at) }) : t('panel_no_products')}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <p role="status" className="text-sm">{queued.length ? t('panel_queued', { count: queued.length }) : t('panel_nothing_queued')}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-11" disabled={!!busy || !online} onClick={() => void refresh()}>
            {busy === 'refresh' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}{t('refresh')}</Button>
          {queued.length ? <Button type="button" className="min-h-11" disabled={!!busy || !online} onClick={() => void send()}>
            {busy === 'send' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('send_now', { count: queued.length })}</Button> : null}
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {attention.length ? (
          <section aria-labelledby="till-attention" className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <h3 id="till-attention" className="text-sm font-semibold">{t('attention_title', { count: attention.length })}</h3>
            <p className="text-sm text-muted-foreground">{t('attention_body')}</p>
            <ul className="space-y-2">
              {attention.map(sale => (
                <li key={sale.sequence} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm">
                  <div><div className="font-medium">{t('sale_name', { n: sale.sequence })} · {f.money(sale.total)} · {f.dateTime(sale.created_at)}</div>
                    <div className="text-destructive">{sale.error}</div></div>
                  <Button type="button" variant="outline" size="sm" className="min-h-10" disabled={!!busy || !online}
                    onClick={async () => { await retrySale(sale.sequence); await reload(); await send(); }}>{t('retry_sale', { n: sale.sequence })}</Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function OfflineSaleScreen() {
  const t = useTranslations('offline');
  const f = useFormat();
  const { till, catalogue, sales, ready, reload } = useTillState();
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Array<{ product: CatalogueProduct; qty: number }>>([]);
  const [cashReceived, setCashReceived] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSale, setLastSale] = useState<QueuedSale | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus(); }, [ready]);

  const expired = catalogue ? new Date(catalogue.expires_at).getTime() < Date.now() : true;
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!catalogue || q.length < 2) return [];
    return catalogue.products.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || p.primary_barcode === search.trim()).slice(0, 12);
  }, [catalogue, search]);
  const lineTotals = cart.map(line => offlineLineTotal(line.product, line.qty));
  const total = lineTotals.every(v => v !== null) ? sumMoney(lineTotals as string[]) : null;
  const change = cashReceived !== '' && total !== null && Number.isFinite(Number(cashReceived)) ? Number(cashReceived) - Number(total) : null;
  const queuedCount = sales.filter(s => s.status === 'queued').length;

  const add = (product: CatalogueProduct) => {
    if (product.is_serialized) { toast.error(t('serial_online')); return; }
    setCart(current => {
      const found = current.find(line => line.product.id === product.id);
      if (found) return current.map(line => line.product.id === product.id ? { ...line, qty: Math.min(OFFLINE_MAX_QTY, line.qty + 1) } : line);
      return [...current, { product, qty: 1 }];
    });
    setSearch(''); searchRef.current?.focus();
  };

  async function save() {
    if (!till || !cart.length || total === null || saving || expired) return;
    setSaving(true);
    try {
      const sale = await queueCashSale(till, cart);
      setLastSale(sale); setCart([]); setCashReceived('');
      await reload();
    } catch (cause) { toast.error(t('save_failed', { reason: cause instanceof Error ? cause.message : String(cause) })); }
    finally { setSaving(false); searchRef.current?.focus(); }
  }

  const banner = (
    <div role="status" className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
      <WifiOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div><p className="font-medium">{t('offline_title')}</p><p className="text-pretty">{t('offline_body')}</p></div>
    </div>
  );

  if (!ready) return null;
  if (!till || !catalogue) return (
    <div className="space-y-4">{banner}<Card><CardContent className="pt-6 text-sm">{t('not_set_up')}</CardContent></Card></div>
  );

  return (
    <div className="min-w-0 space-y-4 pb-28 md:pb-4">
      {banner}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('screen_title')}</h1>
        <p className="text-sm text-muted-foreground">{t('screen_subtitle', { label: till.label, count: queuedCount })}</p>
      </div>
      {expired ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">{t('expired')}</p> : null}
      {lastSale ? (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-6">
            <p role="status" className="text-sm">{t('queued_done', { n: lastSale.sequence, amount: f.money(lastSale.total) })}</p>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setLastSale(null)}>{t('next_sale')}</Button>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card>
            <CardContent className="space-y-3 pt-6">
              <Label htmlFor="offline-search">{t('search_label')}</Label>
              <Input ref={searchRef} id="offline-search" autoComplete="off" className="h-12 text-base" value={search} disabled={expired}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); add(results[0]); } }} />
              {results.length ? (
                <div role="group" aria-label={t('results_label')} className="grid gap-2 sm:grid-cols-2">
                  {results.map(p => (
                    <button key={p.id} type="button" onClick={() => add(p)} disabled={p.is_serialized}
                      className="min-h-12 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60">
                      <span className="block font-medium">{p.name}</span>
                      <span className="block text-muted-foreground">{p.code} · {p.is_serialized ? t('serial_online') : f.money(p.line_totals[0])}</span>
                    </button>
                  ))}
                </div>
              ) : search.trim().length >= 2 ? <p className="text-sm text-muted-foreground">{t('no_results')}</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base"><h2>{t('cart_title')}</h2></CardTitle></CardHeader>
            <CardContent>
              {cart.length === 0 ? <p className="text-sm text-muted-foreground">{t('cart_empty')}</p> : (
                <ul className="space-y-3">
                  {cart.map((line, index) => (
                    <li key={line.product.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0">
                      <div className="min-w-0"><div className="font-medium">{line.product.name}</div><div className="text-xs text-muted-foreground">{line.product.code}</div></div>
                      <div className="flex items-center gap-2">
                        <Button type="button" variant="outline" size="icon" className="size-11" aria-label={t('decrease', { name: line.product.name })}
                          onClick={() => setCart(c => c.flatMap(l => l.product.id !== line.product.id ? [l] : l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []))}><Minus aria-hidden="true" /></Button>
                        <span className="w-6 text-center tabular-nums" aria-live="polite">{line.qty}</span>
                        <Button type="button" variant="outline" size="icon" className="size-11" disabled={line.qty >= OFFLINE_MAX_QTY} aria-label={t('increase', { name: line.product.name })}
                          onClick={() => setCart(c => c.map(l => l.product.id === line.product.id ? { ...l, qty: l.qty + 1 } : l))}><Plus aria-hidden="true" /></Button>
                        <span className="w-28 text-right tabular-nums">{lineTotals[index] ? f.money(lineTotals[index]!) : '—'}</span>
                        <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t('remove', { name: line.product.name })}
                          onClick={() => setCart(c => c.filter(l => l.product.id !== line.product.id))}><Trash2 className="text-destructive" aria-hidden="true" /></Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {cart.some(line => line.qty >= OFFLINE_MAX_QTY) ? <p className="mt-2 text-xs text-muted-foreground">{t('max_qty', { max: OFFLINE_MAX_QTY })}</p> : null}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base"><h2>{t('pay_title')}</h2></CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-baseline justify-between border-b pb-2"><span className="font-semibold">{t('total')}</span><span className="text-2xl font-bold tabular-nums">{f.money(total ?? 0)}</span></div>
            <p className="text-sm text-muted-foreground">{t('cash_only')}</p>
            <div className="space-y-1.5">
              <Label htmlFor="offline-cash">{t('cash_received')}</Label>
              <Input id="offline-cash" type="number" inputMode="decimal" min="0" step="any" className="h-12 text-base tabular-nums" value={cashReceived} onChange={e => setCashReceived(e.target.value)} aria-describedby="offline-change" />
              <p id="offline-change" role="status" className={`text-sm tabular-nums ${change !== null && change < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                {change === null ? t('change_hint') : change < 0 ? t('cash_short', { amount: f.money(-change) }) : t('change', { amount: f.money(change) })}
              </p>
            </div>
            <Button type="button" size="lg" className="min-h-14 w-full text-base" disabled={saving || !cart.length || total === null || expired || (change !== null && change < 0)} onClick={() => void save()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('save', { amount: f.money(total ?? 0) })}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
