// src/app/(erp)/dashboard/deliveries/page.tsx
// Delivery orders list with status badges + transition buttons.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Truck, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';

interface Delivery {
  id: string;
  reference_no: string;
  status: string;
  sale: { referenceNo: string; grand_total: string };
  delivery_method: string;
  courier_code: string | null;
  recipient_name: string;
  recipient_phone: string;
  cod_amount: string;
  item_count: number;
  created_at: string;
  delivered_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'outline', packing: 'secondary', ready: 'secondary',
  dispatched: 'default', in_transit: 'default',
  delivered: 'default', failed: 'destructive', returned: 'destructive', cancelled: 'secondary',
};

const NEXT_STATUS: Record<string, string[]> = {
  pending: ['packing', 'cancelled'],
  packing: ['ready'],
  ready: ['dispatched'],
  dispatched: ['in_transit'],
  in_transit: ['delivered', 'failed', 'returned'],
};

export default function DeliveriesPage() {
  const [items, setItems] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/deliveries?limit=50');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load deliveries');
      setItems(data.items ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleTransition(id: string, toStatus: string) {
    setTransitioning(id);
    try {
      const idempotencyKey = `del-${id}-${toStatus}-${Date.now()}`;
      const res = await fetch(`/api/v1/deliveries/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ to_status: toStatus }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success(`Delivery → ${toStatus}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally { setTransitioning(null); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Truck className="h-6 w-6" /> Deliveries</h1>
        <p className="text-muted-foreground">Delivery orders linked to posted sales (last 30 days). Feature-flagged per §20.D14.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Delivery Orders ({items.length})</CardTitle>
          {!loading && !error && <Button size="sm" variant="ghost" onClick={load}>Refresh</Button>}
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingState label="Loading deliveries…" />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Truck className="h-8 w-8 text-muted-foreground/50" />}
              message="No delivery orders in the last 30 days."
            />
          ) : (
            <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
              {items.map(d => (
                <div key={d.id} className="border rounded p-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="font-mono text-sm font-medium">{d.reference_no}</code>
                      <Badge variant={STATUS_COLORS[d.status] as 'outline' | 'secondary' | 'default' | 'destructive'}>{d.status}</Badge>
                      <Badge variant="outline" className="text-xs">{d.delivery_method}</Badge>
                      {d.courier_code && <Badge variant="secondary" className="text-xs">{d.courier_code}</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(d.created_at).toLocaleString()}</span>
                  </div>
                  <div className="text-sm mt-1 flex flex-wrap gap-x-2 gap-y-1">
                    <span>Sale: <code className="font-mono">{d.sale.referenceNo}</code></span>
                    <span>•</span>
                    <span>{d.recipient_name} ({d.recipient_phone})</span>
                    <span>•</span>
                    <span>COD: ৳ {parseFloat(d.cod_amount).toFixed(2)}</span>
                    <span>•</span>
                    <span>{d.item_count} items</span>
                  </div>
                  {NEXT_STATUS[d.status] && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {NEXT_STATUS[d.status].map(s => (
                        <Button
                          key={s}
                          size="sm"
                          variant={s === 'cancelled' || s === 'failed' || s === 'returned' ? 'destructive' : 'default'}
                          onClick={() => handleTransition(d.id, s)}
                          disabled={transitioning === d.id}
                          className="min-h-[36px]"
                        >
                          {transitioning === d.id && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                          <ChevronRight className="h-3 w-3 mr-1" />{s}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
