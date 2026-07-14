// src/app/(erp)/dashboard/sales/page.tsx
// Sales list with status badges.

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Receipt } from 'lucide-react';
import { toast } from 'sonner';

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

  useEffect(() => {
    fetch('/api/v1/sales?limit=50')
      .then(r => r.json())
      .then(d => setSales(d.items ?? []))
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

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
        <p className="text-muted-foreground">Posted POS/customer invoices. Voidable within 24 hours.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Sales ({sales.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : sales.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No sales yet. Go to <a href="/dashboard/pos" className="text-primary hover:underline">POS</a> to make a sale.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2">Reference</th>
                    <th>Customer</th>
                    <th>Biller</th>
                    <th>Status</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Items</th>
                    <th className="text-right">Payments</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map(s => (
                    <tr key={s.id} className="border-b hover:bg-slate-50">
                      <td className="py-2 font-mono">{s.reference_no}</td>
                      <td>{s.customer?.name ?? 'Walk-in'}</td>
                      <td className="text-xs">{s.biller?.name}</td>
                      <td>
                        <Badge variant={s.sale_status === 'completed' ? 'default' : s.sale_status === 'voided' ? 'destructive' : 'secondary'}>
                          {s.sale_status}
                        </Badge>
                      </td>
                      <td className="text-right font-mono">{s.currency_code} {parseFloat(s.grand_total).toFixed(2)}</td>
                      <td className="text-right">{s.item_count}</td>
                      <td className="text-right">{s.payment_count}</td>
                      <td className="text-xs">{s.posted_at ? new Date(s.posted_at).toLocaleString() : '—'}</td>
                      <td>
                        {s.sale_status === 'completed' && (
                          <Button size="sm" variant="ghost" onClick={() => handleVoid(s.id)}>Void</Button>
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
