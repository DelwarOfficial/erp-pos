// src/app/(erp)/dashboard/inventory/opening-stock/page.tsx
// Post opening stock for a warehouse.

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';

interface Warehouse { id: string; name: string; code: string }
interface Product { id: string; name: string; code: string; isSerialized: boolean }

export default function OpeningStockPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [referenceNo, setReferenceNo] = useState(`OS-${Date.now()}`);
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<Array<{ productId: string; quantity: string; unitCost: string; serials: string }>>([
    { productId: '', quantity: '', unitCost: '', serials: '' },
  ]);

  useEffect(() => {
    // Fetch warehouses (via branches) + products
    fetch('/api/v1/products?limit=200').then(r => r.json()).then(d => setProducts(d.items ?? [])).catch(console.error);
    // Warehouses: we need an endpoint. For now, use the products endpoint's category info.
    // TODO: add /api/v1/warehouses endpoint
  }, []);

  function addItem() {
    setItems([...items, { productId: '', quantity: '', unitCost: '', serials: '' }]);
  }
  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }
  function updateItem(idx: number, field: string, value: string) {
    setItems(items.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const idempotencyKey = `opening-stock-${Date.now()}`;
      const res = await fetch('/api/v1/inventory/opening-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          warehouse_id: warehouseId,
          business_date: new Date(businessDate).toISOString(),
          reference_no: referenceNo,
          items: items.filter(i => i.productId && i.quantity).map(i => ({
            product_id: i.productId,
            quantity: Number(i.quantity),
            unit_cost: Number(i.unitCost),
            serials: i.serials ? i.serials.split(',').map(s => s.trim()).filter(Boolean) : undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Failed to post opening stock');
        return;
      }
      toast.success(`Opening stock posted: ${data.item_count} items`);
      router.push('/dashboard/inventory');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Post Opening Stock</h1>
        <p className="text-muted-foreground">
          Initialize a warehouse with opening balances. Each line creates an immutable stock_movement with movementType='opening_stock'.
          The moving-average cost is set from unit_cost.
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>Opening Stock Details</CardTitle>
            <CardDescription>Can only be posted for a warehouse with no prior stock movements.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Warehouse *</Label>
                <Input placeholder="Warehouse UUID" value={warehouseId} onChange={e => setWarehouseId(e.target.value)} required />
              </div>
              <div>
                <Label>Reference No *</Label>
                <Input value={referenceNo} onChange={e => setReferenceNo(e.target.value)} required />
              </div>
              <div>
                <Label>Business Date *</Label>
                <Input type="date" value={businessDate} onChange={e => setBusinessDate(e.target.value)} required />
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">Items</h3>
                <Button type="button" size="sm" variant="outline" onClick={addItem}><Plus className="h-4 w-4 mr-1" /> Add Line</Button>
              </div>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-4">
                      <Label className="text-xs">Product</Label>
                      <Select value={item.productId} onValueChange={v => updateItem(idx, 'productId', v)}>
                        <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                        <SelectContent>
                          {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Quantity</Label>
                      <Input type="number" step="0.0001" value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} required />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Unit Cost (BDT)</Label>
                      <Input type="number" step="0.000001" value={item.unitCost} onChange={e => updateItem(idx, 'unitCost', e.target.value)} required />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Serials (comma-separated, optional)</Label>
                      <Input value={item.serials} onChange={e => updateItem(idx, 'serials', e.target.value)} placeholder="IMEI1, IMEI2" />
                    </div>
                    <div className="col-span-1">
                      <Button type="button" size="icon" variant="ghost" onClick={() => removeItem(idx)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button type="button" variant="ghost" onClick={() => router.push('/dashboard/inventory')}>Cancel</Button>
            <Button type="submit" disabled={loading || !warehouseId}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Post Opening Stock
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
