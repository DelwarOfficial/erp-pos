// src/app/(erp)/dashboard/deliveries/page.tsx
// Delivery orders list with status badges + transition buttons.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Truck, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

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
  const [transitioning, setTransitioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/deliveries?limit=50');
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
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
    } finally { setTransitioning(null); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Truck className="h-6 w-6" /> Deliveries</h1>
        <p className="text-muted-foreground">Delivery orders linked to posted sales. Feature-flagged per §20.D14.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Delivery Orders ({items.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No delivery orders yet.</div>
          ) : (
            <div className="space-y-2">
              {items.map(d => (
                <div key={d.id} className="border rounded p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-sm font-medium">{d.reference_no}</code>
                      <Badge variant={STATUS_COLORS[d.status] as any}>{d.status}</Badge>
                      <Badge variant="outline" className="text-xs">{d.delivery_method}</Badge>
                      {d.courier_code && <Badge variant="secondary" className="text-xs">{d.courier_code}</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(d.created_at).toLocaleString()}</span>
                  </div>
                  <div className="text-sm mt-1">
                    Sale: <code className="font-mono">{d.sale.referenceNo}</code> • 
                    {d.recipient_name} ({d.recipient_phone}) • 
                    COD: ৳ {parseFloat(d.cod_amount).toFixed(2)} • 
                    {d.item_count} items
                  </div>
                  {NEXT_STATUS[d.status] && (
                    <div className="flex gap-2 mt-2">
                      {NEXT_STATUS[d.status].map(s => (
                        <Button
                          key={s}
                          size="sm"
                          variant={s === 'cancelled' || s === 'failed' || s === 'returned' ? 'destructive' : 'default'}
                          onClick={() => handleTransition(d.id, s)}
                          disabled={transitioning === d.id}
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
