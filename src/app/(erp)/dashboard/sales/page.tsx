// src/app/(erp)/dashboard/sales/page.tsx
// Sales list with status badges.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';
import { apiFetch } from '@/lib/api/client';
import { SaleDetail } from '@/components/sales/SaleDetail';
import { useDashboardSession } from '@/components/dashboard/session';
import { useWorkflowMutation } from '@/hooks/useWorkflowMutation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Sale {
  id: string;
  reference_no: string;
  sale_status: string;
  customer: { id: string; name: string } | null;
  biller: { id: string; name: string; email: string } | null;
  currency_code: string;
  grand_total: string;
  base_grand_total: string;
  item_count: number;
  payment_count: number;
  business_date: string;
  posted_at: string | null;
  voided_at: string | null;
}

export default function SalesPage() {
  const session = useDashboardSession();
  const command = useWorkflowMutation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [filters, setFilters] = useState(''); const [cursor, setCursor] = useState<string | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next?: string) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams(filters); query.set('limit', '50'); query.set('all_dates', 'true'); if (next) query.set('cursor', next);
      const res = await apiFetch(`/api/v1/sales?${query}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load sales');
      setSales(current => next ? [...current, ...(data.items ?? [])] : data.items ?? []); setCursor(data.has_more ? data.next_cursor : null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  async function handleVoid(saleId: string) {
    const reason = prompt('Void reason?');
    if (!reason) return;
    if (!window.confirm('Void this sale and reverse its stock, payments and accounting entries?')) return;
    const result = await command.mutate(`/api/v1/sales/${saleId}/void`, { reason });
    if (result) { toast.success('Sale voided'); await load(); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Receipt className="h-6 w-6" /> Sales</h1>
        <p className="text-muted-foreground">Find invoices, review payments, returns and receipts.</p>
      </div>

      {command.error ? <p role="alert">{command.error}</p> : null}
      {selectedId ? <SaleDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(null)} onChanged={() => void load()} /> : null}
      <form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={event => { event.preventDefault(); const query = new URLSearchParams(); if (search.trim()) query.set('search', search.trim()); if (from) query.set('from', new Date(from).toISOString()); if (to) query.set('to', new Date(`${to}T23:59:59.999Z`).toISOString()); setFilters(query.toString()); if (query.toString() === filters) void load(); }}>
        <div><Label htmlFor="sales-search">Reference or customer</Label><Input id="sales-search" value={search} onChange={e => setSearch(e.target.value)} /></div><div><Label htmlFor="sales-from">From</Label><Input id="sales-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div><div><Label htmlFor="sales-to">To</Label><Input id="sales-to" type="date" min={from || undefined} value={to} onChange={e => setTo(e.target.value)} /></div><Button type="submit" variant="outline" disabled={loading}>Apply filters</Button>
      </form>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Sales ({sales.length})</CardTitle>
          {!loading && !error && (
            <Button size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingState label="Loading sales…" />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
          ) : sales.length === 0 ? (
            <EmptyState
              icon={<Receipt className="h-8 w-8 text-muted-foreground/50" />}
              message={<>No sales in the last 30 days. Go to <a href="/dashboard/pos" className="text-primary hover:underline">POS</a> to make a sale.</>}
            />
          ) : (
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3">Reference</th>
                    <th className="pr-3">Customer</th>
                    <th className="pr-3">Biller</th>
                    <th className="pr-3">Status</th>
                    <th className="pr-3 text-right">Total</th>
                    <th className="pr-3 text-right">Items</th>
                    <th className="pr-3 text-right">Payments</th>
                    <th className="pr-3">Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map(s => (
                    <tr key={s.id} className="border-b hover:bg-muted">
                      <td className="py-2 pr-3 font-mono whitespace-nowrap">{s.reference_no}</td>
                      <td className="pr-3 truncate max-w-[160px]">{s.customer?.name ?? 'Walk-in'}</td>
                      <td className="pr-3 text-xs truncate max-w-[120px]">{s.biller?.name ?? '—'}</td>
                      <td className="pr-3">
                        <Badge variant={s.sale_status === 'completed' ? 'default' : s.sale_status === 'voided' ? 'destructive' : 'secondary'}>
                          {s.sale_status}
                        </Badge>
                      </td>
                      <td className="pr-3 text-right font-mono whitespace-nowrap">{s.currency_code} {parseFloat(s.grand_total).toFixed(2)}</td>
                      <td className="pr-3 text-right">{s.item_count}</td>
                      <td className="pr-3 text-right">{s.payment_count}</td>
                      <td className="pr-3 text-xs whitespace-nowrap">{s.posted_at ? new Date(s.posted_at).toLocaleString() : '—'}</td>
                      <td>
                        <Button variant="outline" size="sm" onClick={() => setSelectedId(s.id)}>View sale</Button>
                        {s.sale_status === 'completed' && (session?.is_global || session?.permissions.includes('sale.void')) && (
                          <Button size="sm" variant="ghost" disabled={command.pending} onClick={() => handleVoid(s.id)} className="min-h-[36px]">Void</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cursor && !loading ? <Button className="mt-4" variant="outline" onClick={() => void load(cursor)}>Load older sales</Button> : null}
        </CardContent>
      </Card>
    </div>
  );
}
