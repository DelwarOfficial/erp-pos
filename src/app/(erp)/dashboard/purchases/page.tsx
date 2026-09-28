// src/app/(erp)/dashboard/purchases/page.tsx
// Purchase orders list + create form.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Package } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api/client';
import { EntityPicker, type BusinessEntity } from '@/components/shared/EntityPicker';
import { PurchaseDetail } from '@/components/purchases/PurchaseDetail';
import { useDashboardSession } from '@/components/dashboard/session';

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

export default function PurchasesPage() {
  const session = useDashboardSession();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);

  const loadPurchases = useCallback(async (next?: string) => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams(filters);
      query.set('limit', '50'); query.set('all_dates', 'true');
      if (next) query.set('cursor', next);
      const res = await apiFetch(`/api/v1/purchases?${query}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? 'Unable to load purchases');
      setPurchases(current => next ? [...current, ...(data.items ?? [])] : data.items ?? []);
      setCursor(data.has_more ? data.next_cursor : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load purchases');
    } finally {
      setLoading(false);
    }
  }, [filters]);
  useEffect(() => { void loadPurchases(); }, [loadPurchases]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6" /> Purchases</h1>
          <p className="text-muted-foreground">Purchase orders + receivings. Stock changes only through receiving.</p>
        </div>
        {(session?.is_global || session?.permissions.includes('purchase.create')) && <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" /> New Purchase
        </Button>}
      </div>

      {showCreate && (
        <CreatePurchaseForm
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadPurchases(); }}
        />
      )}

      {selectedId && <PurchaseDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(null)} onChanged={() => void loadPurchases()} />}

      <Card>
        <CardHeader>
          <CardTitle>Purchase Orders ({purchases.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="mb-4 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={event => {
            event.preventDefault();
            const query = new URLSearchParams();
            if (search.trim()) query.set('search', search.trim());
            if (from) query.set('from', new Date(from).toISOString());
            if (to) query.set('to', new Date(`${to}T23:59:59.999Z`).toISOString());
            setFilters(query.toString());
            if (query.toString() === filters) void loadPurchases();
          }}>
            <div><Label htmlFor="purchase-search">Reference or supplier</Label><Input id="purchase-search" value={search} onChange={e => setSearch(e.target.value)} /></div>
            <div><Label htmlFor="purchase-from">From</Label><Input id="purchase-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div><Label htmlFor="purchase-to">To</Label><Input id="purchase-to" type="date" min={from || undefined} value={to} onChange={e => setTo(e.target.value)} /></div>
            <Button type="submit" variant="outline" disabled={loading}>Apply filters / refresh</Button>
          </form>
          {error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={() => void loadPurchases()}>Retry purchases</Button></div> : loading ? (
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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map(p => (
                    <tr key={p.id} className="border-b hover:bg-muted">
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
                      <td><Button variant="outline" size="sm" onClick={() => setSelectedId(p.id)}>View purchase</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cursor && !loading && !error ? <Button className="mt-4" variant="outline" onClick={() => void loadPurchases(cursor)}>Load older purchases</Button> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function CreatePurchaseForm({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [warehouse, setWarehouse] = useState<BusinessEntity | null>(null);
  const [supplier, setSupplier] = useState<BusinessEntity | null>(null);
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState('BDT');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [items, setItems] = useState<Array<{ productId: string; product?: BusinessEntity; qty: string; unitCost: string }>>([{ productId: '', qty: '', unitCost: '' }]);
  const [creating, setCreating] = useState(false);
  const retry = useRef<{ payload: string; key: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouse?.branch?.id || !supplier) {
      toast.error('Select a supplier and warehouse before creating the purchase.');
      return;
    }
    if (items.some(item => !item.productId || Number(item.qty) <= 0 || item.unitCost === '' || Number(item.unitCost) < 0)) {
      toast.error('Every line needs a product, positive quantity and non-negative unit cost.');
      return;
    }
    setCreating(true);
    try {
      const payload = JSON.stringify({
          branch_id: warehouse.branch.id,
          warehouse_id: warehouse.id,
          supplier_id: supplier.id,
          currency_code: currency,
          exchange_rate: Number(exchangeRate),
          order_date: new Date(orderDate).toISOString(),
          items: items.filter(i => i.productId && i.qty).map(i => ({
            product_id: i.productId,
            qty_ordered: Number(i.qty),
            unit_cost: Number(i.unitCost),
          })),
        });
      if (retry.current?.payload !== payload) retry.current = { payload, key: crypto.randomUUID() };
      const res = await apiFetch('/api/v1/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': retry.current.key },
        body: payload,
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <EntityPicker label="Supplier" endpoint="/api/v1/suppliers" value={supplier} onChange={setSupplier} disabled={creating} />
            <div>
              <EntityPicker label="Warehouse" endpoint="/api/v1/warehouses" serverSearch={false} value={warehouse} onChange={setWarehouse} disabled={creating} />
              {warehouse?.branch ? <p className="mt-1 text-xs text-muted-foreground">Branch: {warehouse.branch.name}</p> : null}
            </div>
            <div>
              <Label htmlFor="field-app-erp-dashboard-purchases-page-3">Order Date *</Label>
              <Input id="field-app-erp-dashboard-purchases-page-3" type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="field-app-erp-dashboard-purchases-page-4">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="field-app-erp-dashboard-purchases-page-4"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BDT">BDT (Taka)</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {currency !== 'BDT' && (
              <div>
                <Label htmlFor="field-app-erp-dashboard-purchases-page-5">Exchange Rate to BDT *</Label>
                <Input id="field-app-erp-dashboard-purchases-page-5" type="number" step="0.000001" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} required />
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
                <div key={idx} className="grid grid-cols-2 lg:grid-cols-12 gap-3 items-end rounded-md border p-3">
                  <div className="col-span-2 lg:col-span-6 min-w-0">
                    <EntityPicker label={`Product ${idx + 1}`} endpoint="/api/v1/products?is_active=true" value={item.product ?? null} disabled={creating} onChange={product => setItems(current => current.map((it, i) => i === idx ? { ...it, product, productId: product.id } : it))} />
                  </div>
                  <div className="lg:col-span-3 min-w-0">
                    <Label htmlFor={`field-app-erp-dashboard-purchases-page-7-${idx}`} className="text-xs">Qty Ordered</Label>
                    <Input id={`field-app-erp-dashboard-purchases-page-7-${idx}`} type="number" step="0.0001" value={item.qty} onChange={e => setItems(items.map((it, i) => i === idx ? { ...it, qty: e.target.value } : it))} required />
                  </div>
                  <div className="lg:col-span-3 min-w-0">
                    <Label htmlFor={`field-app-erp-dashboard-purchases-page-8-${idx}`} className="text-xs">Unit Cost ({currency})</Label>
                    <Input id={`field-app-erp-dashboard-purchases-page-8-${idx}`} type="number" step="0.000001" value={item.unitCost} onChange={e => setItems(items.map((it, i) => i === idx ? { ...it, unitCost: e.target.value } : it))} required />
                  </div>
                  <div className="col-span-2 lg:col-span-12 flex justify-end">
                    <Button type="button" size="sm" variant="outline" aria-label={`Remove purchase line ${idx + 1}`} disabled={creating || items.length <= 1}
                      onClick={() => setItems(current => current.length > 1 ? current.filter((_, index) => index !== idx) : current)}>Remove line</Button>
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
