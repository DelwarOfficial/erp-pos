// src/app/(erp)/dashboard/inventory/page.tsx
// Warehouse stock overview + low-stock alerts.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Package, AlertTriangle, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';

interface StockItem {
  id: string;
  warehouse: { id: string; name: string; code: string };
  product: { id: string; name: string; code: string; isSerialized: boolean; unit: { code: string; name: string } };
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
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/inventory/stocks?${lowStockOnly ? 'low_stock=true' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load inventory');
      setItems(data.items ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [lowStockOnly]);

  useEffect(() => { load(); }, [load]);

  const lowStockCount = items.filter(i => i.is_low_stock).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6" /> Inventory
          </h1>
          <p className="text-muted-foreground">Warehouse stock projections with moving-average cost.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/dashboard/inventory/opening-stock">
            <Button variant="outline" className="min-h-[44px]">Post Opening Stock</Button>
          </Link>
          <Button variant={lowStockOnly ? 'default' : 'outline'} onClick={() => setLowStockOnly(!lowStockOnly)} className="min-h-[44px]">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Low Stock ({lowStockCount})
          </Button>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>SKUs Tracked</CardDescription></CardHeader>
          <CardContent><CardTitle className="text-2xl">{items.length}</CardTitle></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Low Stock</CardDescription></CardHeader>
          <CardContent><CardTitle className="text-2xl text-amber-600">{lowStockCount}</CardTitle></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Inventory Value (BDT)</CardDescription></CardHeader>
          <CardContent>
            <CardTitle className="text-xl md:text-2xl">
              ৳ {items.reduce((s, i) => s + parseFloat(i.inventory_value), 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}
            </CardTitle>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Reserved</CardDescription></CardHeader>
          <CardContent>
            <CardTitle className="text-2xl">
              {items.reduce((s, i) => s + parseFloat(i.qty_reserved), 0).toFixed(4)}
            </CardTitle>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Stock on Hand</CardTitle>
            <CardDescription>Moving-average cost recalculated on inbound; outbound uses pre-movement average (§5.5).</CardDescription>
          </div>
          {!loading && !error && <Button size="sm" variant="ghost" onClick={load}>Refresh</Button>}
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingState label="Loading stock…" />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Package className="h-8 w-8 text-muted-foreground/50" />}
              message={<>No stock records {lowStockOnly ? 'matching the low-stock filter' : 'yet'}. Post opening stock to initialize a warehouse.</>}
              action={
                <Link href="/dashboard/inventory/opening-stock">
                  <Button size="sm" variant="outline">Post Opening Stock</Button>
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3">Product</th>
                    <th className="pr-3">Warehouse</th>
                    <th className="pr-3 text-right">On Hand</th>
                    <th className="pr-3 text-right">Reserved</th>
                    <th className="pr-3 text-right">Available</th>
                    <th className="pr-3 text-right">MAC</th>
                    <th className="pr-3 text-right">Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(s => (
                    <tr key={s.id} className="border-b hover:bg-slate-50">
                      <td className="py-2 pr-3">
                        <div className="font-medium truncate max-w-[200px]">{s.product.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{s.product.code}</div>
                      </td>
                      <td className="pr-3 whitespace-nowrap">{s.warehouse.name}</td>
                      <td className="pr-3 text-right font-mono whitespace-nowrap">{s.qty_on_hand} {s.product.unit.code}</td>
                      <td className="pr-3 text-right font-mono text-amber-600 whitespace-nowrap">{s.qty_reserved}</td>
                      <td className="pr-3 text-right font-mono whitespace-nowrap">{s.qty_available}</td>
                      <td className="pr-3 text-right font-mono whitespace-nowrap">৳ {parseFloat(s.moving_average_cost).toFixed(6)}</td>
                      <td className="pr-3 text-right font-mono whitespace-nowrap">৳ {parseFloat(s.inventory_value).toFixed(2)}</td>
                      <td>{s.is_low_stock && <Badge variant="destructive">low</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stock Movements Ledger</CardTitle>
          <CardDescription>Immutable audit trail of every stock change. <Link href="/dashboard/inventory/movements" className="text-primary hover:underline">View full ledger →</Link></CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard/inventory/movements">
            <Button variant="outline" className="min-h-[44px]">Open Stock Ledger <ArrowRight className="h-4 w-4 ml-2" /></Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
