// src/app/(erp)/dashboard/purchases/page.tsx
// Purchase orders list + create form.

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Package } from 'lucide-react';
import { toast } from 'sonner';

interface Purchase {
  id: string;
  reference_no: string;
  supplier: { id: string; name: string };
  branch: { id: string; name: string; code: string };
  warehouse: { id: string; name: string; code: string };
  order_status: string;
  currency_code: string;
  exchange_rate: string;
  order_date: string;
  grand_total: string;
  base_grand_total: string;
  item_count: number;
  receiving_count: number;
}

interface Supplier { id: string; name: string }
interface Branch { id: string; name: string; code: string }

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadPurchases();
    fetch('/api/v1/suppliers').then(r => r.json()).then(d => setSuppliers(d.items ?? [])).catch(console.error);
    // Branches: we need an endpoint. For now use a simple approach.
  }, []);

  async function loadPurchases() {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/purchases?limit=50');
      const data = await res.json();
      setPurchases(data.items ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6" /> Purchases</h1>
          <p className="text-muted-foreground">Purchase orders + receivings. Stock changes only through receiving.</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-4 w-4 mr-2" /> New Purchase
        </Button>
      </div>

      {showCreate && (
        <CreatePurchaseForm
          suppliers={suppliers}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadPurchases(); }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Purchase Orders ({purchases.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : purchases.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No purchases yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2">Reference</th>
                    <th>Supplier</th>
                    <th>Warehouse</th>
                    <th>Status</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Items</th>
                    <th className="text-right">Receivings</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map(p => (
                    <tr key={p.id} className="border-b hover:bg-slate-50">
                      <td className="py-2 font-mono">{p.reference_no}</td>
                      <td>{p.supplier.name}</td>
                      <td>{p.warehouse.name}</td>
                      <td>
                        <Badge variant={p.order_status === 'received' ? 'default' : p.order_status === 'partially_received' ? 'secondary' : 'outline'}>
                          {p.order_status}
                        </Badge>
                      </td>
                      <td className="text-right font-mono">{p.currency_code} {parseFloat(p.grand_total).toFixed(2)}</td>
                      <td className="text-right">{p.item_count}</td>
                      <td className="text-right">{p.receiving_count}</td>
                      <td className="text-xs">{new Date(p.order_date).toLocaleDateString()}</td>
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

function CreatePurchaseForm({ suppliers, onClose, onCreated }: {
  suppliers: Supplier[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState('BDT');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [items, setItems] = useState<Array<{ productId: string; qty: string; unitCost: string }>>([{ productId: '', qty: '', unitCost: '' }]);
  const [creating, setCreating] = useState(false);
  const [products, setProducts] = useState<Array<{ id: string; name: string; code: string }>>([]);

  useEffect(() => {
    fetch('/api/v1/products?limit=200&is_active=true').then(r => r.json()).then(d => setProducts(d.items ?? [])).catch(console.error);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const idempotencyKey = `purchase-${Date.now()}`;
      const res = await fetch('/api/v1/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          branch_id: warehouseId,  // TODO: separate branch selection; for now use warehouse's branch
          warehouse_id: warehouseId,
          supplier_id: supplierId,
          currency_code: currency,
          exchange_rate: Number(exchangeRate),
          order_date: new Date(orderDate).toISOString(),
          items: items.filter(i => i.productId && i.qty).map(i => ({
            product_id: i.productId,
            qty_ordered: Number(i.qty),
            unit_cost: Number(i.unitCost),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Failed to create purchase');
        return;
      }
      toast.success(`Purchase ${data.reference_no} created`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle>New Purchase Order</CardTitle>
          <CardDescription>Stock changes only when a receiving is posted against this PO.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label>Supplier *</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Warehouse ID *</Label>
              <Input placeholder="Warehouse UUID" value={warehouseId} onChange={e => setWarehouseId(e.target.value)} required />
            </div>
            <div>
              <Label>Order Date *</Label>
              <Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} required />
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BDT">BDT (Taka)</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {currency !== 'BDT' && (
              <div>
                <Label>Exchange Rate to BDT *</Label>
                <Input type="number" step="0.000001" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} required />
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">Items</h3>
              <Button type="button" size="sm" variant="outline" onClick={() => setItems([...items, { productId: '', qty: '', unitCost: '' }])}>
                <Plus className="h-4 w-4 mr-1" /> Add Line
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-6">
                    <Label className="text-xs">Product</Label>
                    <Select value={item.productId} onValueChange={v => setItems(items.map((it, i) => i === idx ? { ...it, productId: v } : it))}>
                      <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                      <SelectContent>
                        {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Qty Ordered</Label>
                    <Input type="number" step="0.0001" value={item.qty} onChange={e => setItems(items.map((it, i) => i === idx ? { ...it, qty: e.target.value } : it))} required />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Unit Cost ({currency})</Label>
                    <Input type="number" step="0.000001" value={item.unitCost} onChange={e => setItems(items.map((it, i) => i === idx ? { ...it, unitCost: e.target.value } : it))} required />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Create Purchase Order
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
