// src/app/(erp)/dashboard/pos/page.tsx
// POS sale screen — scan/search products, build cart, checkout.

'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Search, ShoppingCart, Trash2, Plus, Minus, CreditCard, Loader2 } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  code: string;
  default_price: string;
  is_serialized: boolean;
  unit: { code: string; name: string };
}

interface CartItem {
  productId: string;
  name: string;
  code: string;
  qty: number;
  unitPrice: number;
  serials: string[];
  isSerialized: boolean;
  lineTotal: number;
}

export default function POSPage() {
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [cashierShiftId, setCashierShiftId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [financialAccountId, setFinancialAccountId] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (search.length >= 2) {
      fetch(`/api/v1/products?search=${encodeURIComponent(search)}&limit=10&is_active=true`)
        .then(r => r.json())
        .then(d => setProducts(d.items ?? []))
        .catch(console.error);
    } else {
      setProducts([]);
    }
  }, [search]);

  const subtotal = cart.reduce((s, i) => s + i.lineTotal, 0);
  const taxTotal = cart.reduce((s, i) => s + i.lineTotal * 0.15, 0); // simplified 15% VAT
  const grandTotal = subtotal + taxTotal;

  function addToCart(product: Product) {
    const existing = cart.find(c => c.productId === product.id);
    if (existing) {
      if (!existing.isSerialized) {
        updateQty(product.id, existing.qty + 1);
      }
      return;
    }
    const price = parseFloat(product.default_price);
    setCart([...cart, {
      productId: product.id,
      name: product.name,
      code: product.code,
      qty: 1,
      unitPrice: price,
      serials: [],
      isSerialized: product.is_serialized,
      lineTotal: price,
    }]);
    setSearch('');
    setProducts([]);
  }

  function updateQty(productId: string, qty: number) {
    if (qty <= 0) {
      setCart(cart.filter(c => c.productId !== productId));
      return;
    }
    setCart(cart.map(c => c.productId === productId ? { ...c, qty, lineTotal: c.unitPrice * qty } : c));
  }

  function updateSerials(productId: string, serials: string) {
    const serialArr = serials.split(',').map(s => s.trim()).filter(Boolean);
    setCart(cart.map(c => c.productId === productId ? { ...c, serials: serialArr, qty: serialArr.length } : c));
  }

  function removeFromCart(productId: string) {
    setCart(cart.filter(c => c.productId !== productId));
  }

  async function handleCheckout() {
    if (cart.length === 0) { toast.error('Cart is empty'); return; }
    if (!warehouseId) { toast.error('Warehouse ID required'); return; }
    if (!financialAccountId) { toast.error('Financial account ID required'); return; }

    // Validate serialized products have serials
    for (const item of cart) {
      if (item.isSerialized && item.serials.length !== item.qty) {
        toast.error(`${item.name} requires ${item.qty} serial(s)`);
        return;
      }
    }

    setPosting(true);
    try {
      const idempotencyKey = `sale-${Date.now()}`;
      const res = await fetch('/api/v1/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          branch_id: branchId || warehouseId,
          warehouse_id: warehouseId,
          cashier_shift_id: cashierShiftId || undefined,
          currency_code: 'BDT',
          exchange_rate: 1,
          items: cart.map(c => ({
            product_id: c.productId,
            qty: c.qty,
            unit_price: c.unitPrice,
            serials: c.isSerialized ? c.serials : undefined,
          })),
          payments: [{
            payment_method: paymentMethod,
            amount: grandTotal,
            financial_account_id: financialAccountId,
          }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Sale failed');
        return;
      }
      toast.success(`Sale ${data.referenceNo} posted — ৳${parseFloat(data.grand_total).toFixed(2)}`);
      setCart([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingCart className="h-6 w-6" /> POS — Point of Sale
        </h1>
        <p className="text-muted-foreground">Scan or search products, build the cart, checkout with payment.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: product search + cart */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Search Products</CardTitle></CardHeader>
            <CardContent>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Scan barcode or search by name/code..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>
              {products.length > 0 && (
                <div className="mt-2 border rounded max-h-60 overflow-y-auto">
                  {products.map(p => (
                    <button
                      key={p.id}
                      onClick={() => addToCart(p)}
                      className="w-full flex items-center justify-between p-2 hover:bg-slate-50 border-b text-left"
                    >
                      <div>
                        <div className="font-medium text-sm">{p.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{p.code}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.is_serialized && <Badge variant="secondary" className="text-xs">serialized</Badge>}
                        <span className="font-mono text-sm">৳ {parseFloat(p.default_price).toFixed(2)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Cart ({cart.length})</CardTitle></CardHeader>
            <CardContent>
              {cart.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">Scan a product to start.</div>
              ) : (
                <div className="space-y-2">
                  {cart.map(item => (
                    <div key={item.productId} className="border rounded p-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-medium text-sm">{item.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{item.code}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!item.isSerialized && (
                            <>
                              <Button size="icon" variant="ghost" onClick={() => updateQty(item.productId, item.qty - 1)}>
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="font-mono w-8 text-center">{item.qty}</span>
                              <Button size="icon" variant="ghost" onClick={() => updateQty(item.productId, item.qty + 1)}>
                                <Plus className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                          {item.isSerialized && <Badge variant="secondary" className="text-xs">{item.serials.length} serials</Badge>}
                          <span className="font-mono text-sm w-20 text-right">৳ {item.lineTotal.toFixed(2)}</span>
                          <Button size="icon" variant="ghost" onClick={() => removeFromCart(item.productId)}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      {item.isSerialized && (
                        <Input
                          placeholder="Enter serial numbers (comma-separated)"
                          value={item.serials.join(', ')}
                          onChange={e => updateSerials(item.productId, e.target.value)}
                          className="text-xs"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: checkout panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Checkout</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-mono">৳ {subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">VAT (15%)</span>
                  <span className="font-mono">৳ {taxTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>Grand Total</span>
                  <span className="font-mono">৳ {grandTotal.toFixed(2)}</span>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t">
                <div>
                  <Label className="text-xs">Warehouse ID *</Label>
                  <Input placeholder="Warehouse UUID" value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="text-xs" />
                </div>
                <div>
                  <Label className="text-xs">Cashier Shift ID (optional)</Label>
                  <Input placeholder="Shift UUID" value={cashierShiftId} onChange={e => setCashierShiftId(e.target.value)} className="text-xs" />
                </div>
                <div>
                  <Label className="text-xs">Payment Method</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="bkash">bKash</SelectItem>
                      <SelectItem value="nagad">Nagad</SelectItem>
                      <SelectItem value="rocket">Rocket</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Financial Account ID *</Label>
                  <Input placeholder="Account UUID" value={financialAccountId} onChange={e => setFinancialAccountId(e.target.value)} className="text-xs" />
                </div>
              </div>

              <Button onClick={handleCheckout} disabled={posting || cart.length === 0} className="w-full" size="lg">
                {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CreditCard className="h-4 w-4 mr-2" />}
                Complete Sale — ৳ {grandTotal.toFixed(2)}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
