// src/app/(erp)/dashboard/inventory/page.tsx
// Warehouse stock overview + low-stock alerts.

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Package, AlertTriangle, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

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
  const [lowStockOnly, setLowStockOnly] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/inventory/stocks?${lowStockOnly ? 'low_stock=true' : ''}`)
      .then(r => r.json())
      .then(d => setItems(d.items ?? []))
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [lowStockOnly]);

  const lowStockCount = items.filter(i => i.is_low_stock).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6" /> Inventory
          </h1>
          <p className="text-muted-foreground">Warehouse stock projections with moving-average cost.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/inventory/opening-stock">
            <Button variant="outline">Post Opening Stock</Button>
          </Link>
          <Button variant={lowStockOnly ? 'default' : 'outline'} onClick={() => setLowStockOnly(!lowStockOnly)}>
            <AlertTriangle className="h-4 w-4 mr-2" />
            Low Stock ({lowStockCount})
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
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
            <CardTitle className="text-2xl">
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
        <CardHeader>
          <CardTitle>Stock on Hand</CardTitle>
          <CardDescription>Moving-average cost recalculated on inbound; outbound uses pre-movement average (§5.5).</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No stock yet. Post opening stock to initialize a warehouse.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2">Product</th>
                    <th>Warehouse</th>
                    <th className="text-right">On Hand</th>
                    <th className="text-right">Reserved</th>
                    <th className="text-right">Available</th>
                    <th className="text-right">MAC</th>
                    <th className="text-right">Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(s => (
                    <tr key={s.id} className="border-b hover:bg-slate-50">
                      <td className="py-2">
                        <div className="font-medium">{s.product.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{s.product.code}</div>
                      </td>
                      <td>{s.warehouse.name}</td>
                      <td className="text-right font-mono">{s.qty_on_hand} {s.product.unit.code}</td>
                      <td className="text-right font-mono text-amber-600">{s.qty_reserved}</td>
                      <td className="text-right font-mono">{s.qty_available}</td>
                      <td className="text-right font-mono">৳ {parseFloat(s.moving_average_cost).toFixed(6)}</td>
                      <td className="text-right font-mono">৳ {parseFloat(s.inventory_value).toFixed(2)}</td>
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
            <Button variant="outline">Open Stock Ledger <ArrowRight className="h-4 w-4 ml-2" /></Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
