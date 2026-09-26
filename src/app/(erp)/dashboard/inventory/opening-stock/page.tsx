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
import { apiFetch } from '@/lib/api/client';
import { ErrorState, LoadingState } from '@/components/shared/StateList';

interface Product { id: string; name: string; code: string; isSerialized: boolean }

export default function OpeningStockPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [referenceNo, setReferenceNo] = useState(`OS-${Date.now()}`);
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<Array<{ productId: string; quantity: string; unitCost: string; serials: string }>>([
    { productId: '', quantity: '', unitCost: '', serials: '' },
  ]);

  useEffect(() => { loadProducts(); }, []);

  async function loadProducts() {
    setProductsLoading(true); setProductsError(null);
    try {
      const response = await apiFetch('/api/v1/products?limit=200');
      if (!response.ok) throw new Error('Products could not be loaded. Check your access and try again.');
      const data = await response.json();
      if (!Array.isArray(data.items)) throw new Error('The product list could not be read. Try again.');
      setProducts(data.items);
    } catch (error) {
      setProductsError(error instanceof Error ? error.message : 'Products could not be loaded.');
    } finally { setProductsLoading(false); }
  }

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
      const res = await apiFetch('/api/v1/inventory/opening-stock', {
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
          Set starting quantities and costs for a warehouse. Posting creates permanent stock records.
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>Opening Stock Details</CardTitle>
            <CardDescription>Can only be posted for a warehouse with no prior stock movements.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {productsLoading && <LoadingState label="Loading products…" />}
            {productsError && <ErrorState message={productsError} onRetry={loadProducts} />}
            {!productsLoading && !productsError && products.length === 0 && <p role="status" className="text-sm text-muted-foreground">No products are available for selection.</p>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="field-app-erp-dashboard-inventory-opening-stock-page-1">Warehouse *</Label>
                <Input id="field-app-erp-dashboard-inventory-opening-stock-page-1" placeholder="Warehouse UUID" value={warehouseId} onChange={e => setWarehouseId(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="field-app-erp-dashboard-inventory-opening-stock-page-2">Reference No *</Label>
                <Input id="field-app-erp-dashboard-inventory-opening-stock-page-2" value={referenceNo} onChange={e => setReferenceNo(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="field-app-erp-dashboard-inventory-opening-stock-page-3">Business Date *</Label>
                <Input id="field-app-erp-dashboard-inventory-opening-stock-page-3" type="date" value={businessDate} onChange={e => setBusinessDate(e.target.value)} required />
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">Items</h3>
                <Button type="button" size="sm" variant="outline" onClick={addItem}><Plus className="h-4 w-4 mr-1" /> Add Line</Button>
              </div>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-2 lg:grid-cols-12 gap-3 items-end rounded-md border p-3">
                    <div className="col-span-2 lg:col-span-4 min-w-0">
                      <Label htmlFor={`field-app-erp-dashboard-inventory-opening-stock-page-4-${idx}`} className="text-xs">Product</Label>
                      <Select value={item.productId} onValueChange={v => updateItem(idx, 'productId', v)}>
                        <SelectTrigger id={`field-app-erp-dashboard-inventory-opening-stock-page-4-${idx}`}><SelectValue placeholder="Select product" /></SelectTrigger>
                        <SelectContent>
                          {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="lg:col-span-2 min-w-0">
                      <Label htmlFor={`field-app-erp-dashboard-inventory-opening-stock-page-5-${idx}`} className="text-xs">Quantity</Label>
                      <Input id={`field-app-erp-dashboard-inventory-opening-stock-page-5-${idx}`} type="number" step="0.0001" value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} required />
                    </div>
                    <div className="lg:col-span-2 min-w-0">
                      <Label htmlFor={`field-app-erp-dashboard-inventory-opening-stock-page-6-${idx}`} className="text-xs">Unit Cost (BDT)</Label>
                      <Input id={`field-app-erp-dashboard-inventory-opening-stock-page-6-${idx}`} type="number" step="0.000001" value={item.unitCost} onChange={e => updateItem(idx, 'unitCost', e.target.value)} required />
                    </div>
                    <div className="col-span-2 lg:col-span-3 min-w-0">
                      <Label htmlFor={`field-app-erp-dashboard-inventory-opening-stock-page-7-${idx}`} className="text-xs">Serials (comma-separated, optional)</Label>
                      <Input id={`field-app-erp-dashboard-inventory-opening-stock-page-7-${idx}`} value={item.serials} onChange={e => updateItem(idx, 'serials', e.target.value)} placeholder="IMEI1, IMEI2" />
                    </div>
                    <div className="col-span-1">
                      <Button type="button" size="icon" variant="ghost" aria-label={`Remove line ${idx + 1}`} onClick={() => removeItem(idx)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-3 justify-between">
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
