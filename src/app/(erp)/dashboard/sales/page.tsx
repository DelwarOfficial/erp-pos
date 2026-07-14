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
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/sales?limit=50');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load sales');
      setSales(data.items ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleVoid(saleId: string) {
    const reason = prompt('Void reason?');
    if (!reason) return;
    try {
      const idempotencyKey = `void-${saleId}-${Date.now()}`;
      const res = await fetch(`/api/v1/sales/${saleId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Void failed'); return; }
      toast.success('Sale voided');
      setSales(sales.map(s => s.id === saleId ? { ...s, sale_status: 'voided', voided_at: data.voided_at } : s));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Receipt className="h-6 w-6" /> Sales</h1>
        <p className="text-muted-foreground">Recent POS/customer invoices (last 30 days). Voidable within 24 hours.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Sales ({sales.length})</CardTitle>
          {!loading && !error && (
            <Button size="sm" variant="ghost" onClick={load}>Refresh</Button>
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
                    <tr key={s.id} className="border-b hover:bg-slate-50">
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
                        {s.sale_status === 'completed' && (
                          <Button size="sm" variant="ghost" onClick={() => handleVoid(s.id)} className="min-h-[36px]">Void</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
