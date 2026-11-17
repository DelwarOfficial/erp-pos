// src/app/(erp)/dashboard/sales/page.tsx
// Sales list with status badges.

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';
import { PageHeader } from '@/components/shared/PageHeader';
import { useFormat } from '@/components/i18n/I18nProvider';
import { apiFetch } from '@/lib/api/client';
import { SaleDetail } from '@/components/sales/SaleDetail';
import { useDashboardSession } from '@/components/dashboard/session';
import { useWorkflowMutation } from '@/hooks/useWorkflowMutation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Effective discount as a share of the pre-discount subtotal, for display only (exact paisa, half-up to 2 places). */
function discountPercent(discount: string, subtotal: string): string {
  const paisa = (v: string) => { const [w, d = ''] = Number(v).toFixed(2).split('.'); return BigInt(w) * BigInt(100) + BigInt(d); };
  const part = paisa(discount), whole = paisa(subtotal);
  if (whole <= BigInt(0)) return '';
  const scaled = (part * BigInt(20000) + whole) / (whole * BigInt(2));
  return `${(`${scaled / BigInt(100)}.${String(scaled % BigInt(100)).padStart(2, '0')}`).replace(/\.?0+$/, '')}%`;
}

interface Sale {
  id: string;
  reference_no: string;
  sale_status: string;
  customer: { id: string; name: string } | null;
  biller: { id: string; name: string; email: string } | null;
  currency_code: string;
  /** Sale-time figures, as posted; never recomputed from today's prices. */
  subtotal?: string;
  discount_total?: string;
  tax_total?: string;
  grand_total: string;
  base_grand_total: string;
  item_count: number;
  payment_count: number;
  business_date: string;
  posted_at: string | null;
  voided_at: string | null;
}

const KNOWN_STATUSES = ['completed', 'voided', 'returned', 'partially_returned', 'draft', 'held'];

export default function SalesPage() {
  const session = useDashboardSession();
  const t = useTranslations('sales');
  const f = useFormat();
  const command = useWorkflowMutation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [filters, setFilters] = useState(''); const [cursor, setCursor] = useState<string | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidReasonError, setVoidReasonError] = useState(false);

  const canPost = session?.is_global || session?.permissions.includes('sale.post');
  const canVoid = session?.is_global || session?.permissions.includes('sale.void');

  const load = useCallback(async (next?: string) => {
    // Keep the rows on screen while older ones load.
    if (next) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams(filters); query.set('limit', '50'); query.set('all_dates', 'true'); if (next) query.set('cursor', next);
      const res = await apiFetch(`/api/v1/sales?${query}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? t('load_failed'));
      setSales(current => next ? [...current, ...(data.items ?? [])] : data.items ?? []); setCursor(data.has_more ? data.next_cursor : null);
    } catch (e) {
      const msg = e instanceof Error && e.message && !(e instanceof TypeError) ? e.message : t('load_failed');
      if (next) toast.error(msg); else { setError(msg); toast.error(msg); }
    } finally {
      setLoading(false); setLoadingMore(false);
    }
  }, [filters, t]);

  useEffect(() => { load(); }, [load]);

  async function handleVoid() {
    if (!voidTarget) return;
    const reason = voidReason.trim();
    if (!reason) { setVoidReasonError(true); return; }
    const target = voidTarget;
    const result = await command.mutate(`/api/v1/sales/${target.id}/void`, { reason });
    if (result) {
      toast.success(t('voided', { ref: target.reference_no }));
      setVoidTarget(null); setVoidReason('');
      await load();
    }
  }

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    const query = new URLSearchParams();
    if (search.trim()) query.set('search', search.trim());
    if (from) query.set('from', new Date(from).toISOString());
    if (to) query.set('to', new Date(`${to}T23:59:59.999Z`).toISOString());
    setFilters(query.toString());
    if (query.toString() === filters) void load();
  }

  function clearFilters() {
    setSearch(''); setFrom(''); setTo('');
    setFilters('');
    if (filters === '') void load();
  }

  const statusLabel = (status: string) => KNOWN_STATUSES.includes(status) ? t(`status.${status}`) : status.replaceAll('_', ' ');

  return (
    <div className="space-y-6">
      <PageHeader icon={<Receipt className="h-6 w-6" aria-hidden="true" />} title={t('title')} description={t('subtitle')}
        actions={canPost ? <Button asChild><Link href="/dashboard/pos"><Plus aria-hidden="true" />{t('new_sale')}</Link></Button> : undefined} />

      {command.error && !voidTarget ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{command.error}</p> : null}
      {selectedId ? <SaleDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(null)} onChanged={() => void load()} /> : null}
      <form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={applyFilters}>
        <div className="space-y-1.5"><Label htmlFor="sales-search">{t('filter_search')}</Label><Input id="sales-search" type="search" placeholder={t('filter_search_placeholder')} value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="sales-from">{t('filter_from')}</Label><Input id="sales-from" type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="sales-to">{t('filter_to')}</Label><Input id="sales-to" type="date" min={from || undefined} value={to} onChange={e => setTo(e.target.value)} /></div>
        <div className="flex gap-2">
          <Button type="submit" variant="outline" disabled={loading}>{t('filter_apply')}</Button>
          {(filters || search || from || to) && <Button type="button" variant="ghost" onClick={clearFilters} disabled={loading}>{t('filter_clear')}</Button>}
        </div>
      </form>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base"><h2>{t('list_title', { count: sales.length })}</h2></CardTitle>
          {!loading && !error && (
            <Button type="button" size="sm" variant="ghost" onClick={() => void load()}>{t('refresh')}</Button>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingState label={t('loading')} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : sales.length === 0 ? (
            <EmptyState
              icon={<Receipt className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />}
              message={filters ? t('empty_filtered') : t('empty')}
              action={filters
                ? <Button type="button" variant="outline" onClick={clearFilters}>{t('filter_clear')}</Button>
                : canPost ? <Button asChild><Link href="/dashboard/pos"><Plus aria-hidden="true" />{t('new_sale')}</Link></Button> : undefined}
            />
          ) : (
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_reference')}</TableHead>
                  <TableHead>{t('col_customer')}</TableHead>
                  <TableHead>{t('col_sold_by')}</TableHead>
                  <TableHead>{t('col_status')}</TableHead>
                  <TableHead className="text-right">{t('col_subtotal')}</TableHead>
                  <TableHead className="text-right">{t('col_discount')}</TableHead>
                  <TableHead className="text-right">{t('col_tax')}</TableHead>
                  <TableHead className="text-right">{t('col_total')}</TableHead>
                  <TableHead className="text-right">{t('col_items')}</TableHead>
                  <TableHead className="text-right">{t('col_payments')}</TableHead>
                  <TableHead>{t('col_date')}</TableHead>
                  <TableHead><span className="sr-only">{t('col_actions')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium whitespace-nowrap">{s.reference_no}</TableCell>
                    <TableCell className="truncate max-w-[180px]">{s.customer?.name ?? <span className="text-muted-foreground">{t('walk_in')}</span>}</TableCell>
                    <TableCell className="truncate max-w-[140px]">{s.biller?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={s.sale_status === 'completed' ? 'default' : s.sale_status === 'voided' ? 'destructive' : 'secondary'}>
                        {statusLabel(s.sale_status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">{s.subtotal !== undefined ? f.money(s.subtotal, s.currency_code) : '—'}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">{Number(s.discount_total ?? 0) > 0 ? <>{f.money(s.discount_total!, s.currency_code)}<span className="block text-xs text-muted-foreground">{discountPercent(s.discount_total!, s.subtotal ?? '0')}</span></> : '—'}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">{s.tax_total !== undefined ? f.money(s.tax_total, s.currency_code) : '—'}</TableCell>
                    <TableCell className="text-right whitespace-nowrap font-medium tabular-nums">{f.money(s.grand_total, s.currency_code)}</TableCell>
                    <TableCell className="text-right">{s.item_count}</TableCell>
                    <TableCell className="text-right">{s.payment_count}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{s.posted_at ? f.dateTime(s.posted_at) : '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button type="button" variant="outline" size="sm" onClick={() => setSelectedId(s.id)}>{t('view')}</Button>
                      {s.sale_status === 'completed' && canVoid && (
                        <Button type="button" size="sm" variant="ghost" disabled={command.pending} className="ml-1 text-destructive hover:text-destructive"
                          onClick={() => { command.setError(''); setVoidReason(''); setVoidReasonError(false); setVoidTarget(s); }}>{t('void')}</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {cursor && !loading ? (
            <Button type="button" className="mt-4" variant="outline" disabled={loadingMore} onClick={() => void load(cursor)}>
              {loadingMore && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {loadingMore ? t('loading_more') : t('load_more')}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={!!voidTarget} onOpenChange={open => { if (!open && !command.pending) setVoidTarget(null); }}>
        <DialogContent>
          <form onSubmit={event => { event.preventDefault(); void handleVoid(); }} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>{voidTarget ? t('void_title', { ref: voidTarget.reference_no }) : ''}</DialogTitle>
              <DialogDescription>{voidTarget ? t('void_body', { amount: f.money(voidTarget.grand_total, voidTarget.currency_code) }) : ''}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="void-reason">{t('void_reason')}<span aria-hidden="true" className="text-destructive"> *</span></Label>
              <Textarea id="void-reason" value={voidReason} maxLength={500} required aria-required="true" autoFocus
                aria-invalid={voidReasonError} aria-describedby="void-reason-help"
                onChange={e => { setVoidReason(e.target.value); setVoidReasonError(false); }} />
              <p id="void-reason-help" role={voidReasonError ? 'alert' : undefined} className={`text-xs ${voidReasonError ? 'text-destructive' : 'text-muted-foreground'}`}>
                {voidReasonError ? t('void_reason_required') : t('void_reason_help')}
              </p>
            </div>
            {command.error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{command.error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={command.pending} onClick={() => setVoidTarget(null)}>{t('void_keep')}</Button>
              <Button type="submit" variant="destructive" disabled={command.pending}>
                {command.pending && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {command.pending ? t('void_working') : t('void_confirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
