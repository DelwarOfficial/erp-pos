// src/app/(erp)/dashboard/inventory/page.tsx
// Warehouse stock overview + low-stock alerts.

'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Package, AlertTriangle, Search, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';
import { PageHeader } from '@/components/shared/PageHeader';
import { useFormat } from '@/components/i18n/I18nProvider';
import { apiFetch } from '@/lib/api/client';
import { useDashboardSession } from '@/components/dashboard/session';

interface StockItem {
  id: string;
  warehouse: { id: string; name: string; code: string };
  product: { id: string; name: string; code: string; isSerialized: boolean; isActive: boolean; unit: { code: string; name: string } };
  qty_on_hand: string;
  qty_reserved: string;
  qty_available: string;
  qty_in_transit_out: string;
  qty_damaged: string;
  moving_average_cost: string;
  inventory_value: string;
  is_low_stock: boolean;
}

export default function InventoryPage() {
  const t = useTranslations('inventory');
  const f = useFormat();
  const session = useDashboardSession();
  // "Sell" opens POS, which needs sale.post and an open cashier shift.
  const canSell = Boolean(session?.is_global || session?.permissions.includes('sale.post'));
  const canReadShifts = Boolean(session?.is_global || session?.permissions.includes('shift.read'));
  // null = unknown (not checked, or no shift.read): POS then says what is missing.
  const [hasOpenShift, setHasOpenShift] = useState<boolean | null>(null);
  useEffect(() => {
    if (!canSell || !canReadShifts) return;
    let active = true;
    apiFetch('/api/v1/cashier-shifts?status=open')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (active && d) setHasOpenShift((d.items ?? []).length > 0); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [canSell, canReadShifts]);

  function sellCell(s: StockItem) {
    const reason = !canSell ? t('sell_no_permission')
      : !s.product.isActive ? t('sell_inactive')
      : Number(s.qty_available) <= 0 ? t('sell_none')
      : hasOpenShift === false ? t('sell_no_shift')
      : null;
    if (reason) {
      return (
        <div className="flex flex-col items-start gap-1">
          <Button type="button" size="sm" variant="outline" disabled aria-describedby={`sell-why-${s.id}`} className="min-h-11">
            <ShoppingCart aria-hidden="true" />{t('sell')}
          </Button>
          <span id={`sell-why-${s.id}`} className="max-w-[180px] text-xs text-muted-foreground text-pretty">{reason}</span>
          {canSell && !s.product.isActive && (
            <Link href={`/dashboard/products/${s.product.id}`} className="text-xs font-medium text-primary underline-offset-4 hover:underline">{t('sell_open_product')}</Link>
          )}
          {canSell && s.product.isActive && hasOpenShift === false && Number(s.qty_available) > 0 && (
            <Link href="/dashboard/cashier" className="text-xs font-medium text-primary underline-offset-4 hover:underline">{t('sell_open_shift')}</Link>
          )}
        </div>
      );
    }
    const href = `/dashboard/pos?add=${encodeURIComponent(s.product.id)}&warehouse=${encodeURIComponent(s.warehouse.id)}`;
    return (
      <Button asChild size="sm" className="min-h-11">
        <Link href={href} aria-label={t('sell_named', { name: s.product.name, warehouse: s.warehouse.name })}>
          <ShoppingCart aria-hidden="true" />{t('sell')}
        </Link>
      </Button>
    );
  }
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  // Narrows the rows already loaded; it does not change the request.
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/inventory/stocks?${lowStockOnly ? 'low_stock=true' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? t('load_failed'));
      setItems(data.items ?? []);
    } catch (e) {
      const msg = e instanceof Error && e.message && !(e instanceof TypeError) ? e.message : t('load_failed');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [lowStockOnly, t]);

  useEffect(() => { load(); }, [load]);

  const lowStockCount = items.filter(i => i.is_low_stock).length;
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter(i => `${i.product.name} ${i.product.code} ${i.warehouse.name} ${i.warehouse.code}`.toLowerCase().includes(query));
  }, [items, search]);

  function status(item: StockItem) {
    if (Number(item.qty_on_hand) <= 0) return <Badge variant="destructive">{t('out')}</Badge>;
    if (item.is_low_stock) return <Badge variant="outline" className="gap-1 border-warning-foreground/50 text-foreground"><AlertTriangle className="size-3 text-warning-foreground" aria-hidden="true" />{t('low')}</Badge>;
    return <span className="text-sm text-muted-foreground">{t('ok')}</span>;
  }

  const emptyState = lowStockOnly
    ? <EmptyState icon={<Package className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />} message={t('empty_low')}
        action={<Button type="button" variant="outline" onClick={() => setLowStockOnly(false)}>{t('show_all')}</Button>} />
    : <EmptyState icon={<Package className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />} message={t('empty')}
        action={<Button asChild><Link href="/dashboard/inventory/opening-stock">{t('opening_stock')}</Link></Button>} />;

  return (
    <div className="space-y-6">
      <PageHeader icon={<Package className="h-6 w-6" aria-hidden="true" />} title={t('title')} description={t('subtitle')}
        actions={<>
          <Button variant="outline" asChild><Link href="/dashboard/inventory/transfers">{t('transfers')}</Link></Button>
          <Button variant="outline" asChild><Link href="/dashboard/inventory/counts">{t('counts')}</Link></Button>
          <Button variant="outline" asChild><Link href="/dashboard/inventory/adjustments">{t('adjustments')}</Link></Button>
          <Button asChild><Link href="/dashboard/inventory/opening-stock">{t('opening_stock')}</Link></Button>
        </>} />

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><p className="text-sm text-muted-foreground">{t('stat_products')}</p></CardHeader>
          <CardContent><p className="text-2xl font-semibold tabular-nums">{f.quantity(items.length)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><p className="text-sm text-muted-foreground">{t('stat_low')}</p></CardHeader>
          <CardContent><p className="flex items-center gap-2 text-2xl font-semibold tabular-nums">
            {lowStockCount > 0 && <AlertTriangle className="size-5 text-warning-foreground" aria-hidden="true" />}{f.quantity(lowStockCount)}
          </p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><p className="text-sm text-muted-foreground">{t('stat_value')}</p></CardHeader>
          <CardContent><p className="text-xl md:text-2xl font-semibold tabular-nums">
            {f.money(items.reduce((s, i) => s + parseFloat(i.inventory_value), 0))}
          </p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><p className="text-sm text-muted-foreground">{t('stat_reserved')}</p></CardHeader>
          <CardContent><p className="text-2xl font-semibold tabular-nums">
            {f.quantity(items.reduce((s, i) => s + parseFloat(i.qty_reserved), 0))}
          </p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base"><h2>{t('list_title')}</h2></CardTitle>
            <CardDescription className="text-pretty">{t('list_help')}</CardDescription>
          </div>
          {!loading && !error && <Button type="button" size="sm" variant="ghost" onClick={load}>{t('refresh')}</Button>}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
              <Input type="search" aria-label={t('search_label')} placeholder={t('search_placeholder')} value={search}
                onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Button type="button" variant={lowStockOnly ? 'default' : 'outline'} aria-pressed={lowStockOnly}
              onClick={() => setLowStockOnly(!lowStockOnly)} className="min-h-11">
              <AlertTriangle aria-hidden="true" />{t('low_toggle', { count: lowStockCount })}
            </Button>
          </div>

          {loading ? (
            <LoadingState label={t('loading')} />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
          ) : items.length === 0 ? emptyState : visible.length === 0 ? (
            <EmptyState icon={<Search className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />} message={t('empty_search', { query: search })}
              action={<Button type="button" variant="outline" onClick={() => setSearch('')}>{t('clear_search')}</Button>} />
          ) : (
            <>
              {/* Every stock and cost column stays available on phones: the table
                  scrolls inside its own container rather than dropping columns. */}
              <div>
                <Table className="min-w-[940px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('col_product')}</TableHead>
                      <TableHead>{t('col_warehouse')}</TableHead>
                      <TableHead className="text-right">{t('col_on_hand')}</TableHead>
                      <TableHead className="text-right">{t('col_reserved')}</TableHead>
                      <TableHead className="text-right">{t('col_available')}</TableHead>
                      <TableHead className="text-right">{t('col_cost')}</TableHead>
                      <TableHead className="text-right">{t('col_value')}</TableHead>
                      <TableHead>{t('col_status')}</TableHead>
                      <TableHead>{t('col_actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map(s => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <div className="font-medium truncate max-w-[240px]">{s.product.name}</div>
                          <div className="text-xs text-muted-foreground">{s.product.code}</div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{s.warehouse.name}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{f.quantity(s.qty_on_hand)} <span className="text-muted-foreground">{s.product.unit.code}</span></TableCell>
                        <TableCell className="text-right whitespace-nowrap">{f.quantity(s.qty_reserved)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap font-medium">{f.quantity(s.qty_available)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">৳ {parseFloat(s.moving_average_cost).toFixed(6)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{f.money(s.inventory_value)}</TableCell>
                        <TableCell>{status(s)}</TableCell>
                        <TableCell>{sellCell(s)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base"><h2>{t('movements_title')}</h2></CardTitle>
          <CardDescription className="text-pretty">{t('movements_body')}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
