// src/app/(erp)/dashboard/pos/page.tsx
// POS sale screen — scan/search products, build cart, checkout.
// - Responsive grid: 1 col mobile, 2 col tablet, 3-4 col desktop.
// - Cart is full-width on mobile (sticky total at bottom), side panel on desktop.
// - Loading / error / empty states for product search.
// - Keyboard shortcuts: Enter = checkout, Escape = clear search.

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Search, ShoppingCart, Trash2, Plus, Minus, CreditCard, Loader2, PackageX, AlertCircle } from 'lucide-react';

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
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const subtotal = cart.reduce((s, i) => s + i.lineTotal, 0);
  const taxTotal = cart.reduce((s, i) => s + i.lineTotal * 0.15, 0); // simplified 15% VAT
  const grandTotal = subtotal + taxTotal;

  // Debounced product search — no N+1 (single fetch per query).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (search.trim().length < 2) {
      setProducts([]);
      setSearchError(null);
      setHasSearched(false);
      return;
    }
    setSearching(true);
    setSearchError(null);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/v1/products?search=${encodeURIComponent(search)}&limit=20&is_active=true`)
        .then(async r => {
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d?.error?.message ?? `HTTP ${r.status}`);
          }
          return r.json();
        })
        .then(d => { setProducts(d.items ?? []); setHasSearched(true); })
        .catch(e => { setSearchError(e instanceof Error ? e.message : 'Search failed'); setProducts([]); })
        .finally(() => setSearching(false));
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  function addToCart(product: Product) {
    const existing = cart.find(c => c.productId === product.id);
    if (existing) {
      if (!existing.isSerialized) updateQty(product.id, existing.qty + 1);
      return;
    }
    const price = parseFloat(product.default_price);
    setCart(prev => [...prev, {
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
    searchInputRef.current?.focus();
  }

  function updateQty(productId: string, qty: number) {
    if (qty <= 0) { removeFromCart(productId); return; }
    setCart(prev => prev.map(c => c.productId === productId ? { ...c, qty, lineTotal: c.unitPrice * qty } : c));
  }

  function updateSerials(productId: string, serials: string) {
    const serialArr = serials.split(',').map(s => s.trim()).filter(Boolean);
    setCart(prev => prev.map(c => c.productId === productId ? { ...c, serials: serialArr, qty: serialArr.length } : c));
  }

  function removeFromCart(productId: string) {
    setCart(prev => prev.filter(c => c.productId !== productId));
  }

  const handleCheckout = useCallback(async () => {
    if (cart.length === 0) { toast.error('Cart is empty'); return; }
    if (!warehouseId) { toast.error('Warehouse ID required'); return; }
    if (!financialAccountId) { toast.error('Financial account ID required'); return; }
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
  }, [cart, warehouseId, branchId, cashierShiftId, paymentMethod, financialAccountId, grandTotal]);

  // ── Keyboard shortcuts ──
  // Enter (when not typing in a field other than search) → checkout
  // Escape (when search focused and non-empty) → clear search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTypingField = tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;

      if (e.key === 'Escape' && search && document.activeElement === searchInputRef.current) {
        e.preventDefault();
        setSearch('');
        searchInputRef.current?.focus();
        return;
      }
      // Enter triggers checkout only if not actively typing in inputs (other than the search box).
      if (e.key === 'Enter' && !isTypingField && cart.length > 0 && !posting) {
        e.preventDefault();
        void handleCheckout();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cart, posting, search, handleCheckout]);

  return (
    <div className="space-y-4 pb-28 md:pb-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingCart className="h-6 w-6" /> POS — Point of Sale
        </h1>
        <p className="text-muted-foreground text-sm">
          Scan or search products, build the cart, checkout with payment.
          <span className="hidden md:inline ml-2 text-xs">
            <kbd className="px-1.5 py-0.5 border rounded bg-slate-50">Enter</kbd> to checkout •
            <kbd className="px-1.5 py-0.5 border rounded bg-slate-50 ml-1">Esc</kbd> to clear search
          </span>
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: product search + cart */}
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <Card>
            <CardHeader><CardTitle className="text-base">Search Products</CardTitle></CardHeader>
            <CardContent>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  ref={searchInputRef}
                  placeholder="Scan barcode or search by name/code (min 2 chars)…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9"
                  autoComplete="off"
                  inputMode="search"
                  aria-label="Search products"
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>

              {/* Search error state */}
              {searchError && (
                <div className="mt-2 flex items-center gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded p-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span className="flex-1">{searchError}</span>
                  <Button size="sm" variant="ghost" onClick={() => setSearch(s => s)}>Retry</Button>
                </div>
              )}

              {/* Loading skeleton */}
              {searching && (
                <div className="mt-2 border rounded divide-y" aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="p-2 flex items-center justify-between animate-pulse">
                      <div className="space-y-1.5">
                        <div className="h-3 w-40 bg-slate-200 rounded" />
                        <div className="h-2 w-24 bg-slate-100 rounded" />
                      </div>
                      <div className="h-4 w-16 bg-slate-100 rounded" />
                    </div>
                  ))}
                </div>
              )}

              {/* Empty state — search returned no results */}
              {!searching && !searchError && hasSearched && products.length === 0 && (
                <div className="mt-2 border rounded p-6 text-center text-muted-foreground flex flex-col items-center gap-2">
                  <PackageX className="h-8 w-8 text-muted-foreground/50" />
                  <div className="text-sm">No products match &ldquo;{search}&rdquo;.</div>
                  <Button size="sm" variant="outline" onClick={() => setSearch('')}>Clear search</Button>
                </div>
              )}

              {/* Results list */}
              {!searching && !searchError && products.length > 0 && (
                <div className="mt-2 border rounded max-h-72 overflow-y-auto" role="listbox" aria-label="Product search results">
                  {products.map(p => (
                    <button
                      key={p.id}
                      role="option"
                      aria-selected="false"
                      onClick={() => addToCart(p)}
                      className="w-full flex items-center justify-between p-2.5 hover:bg-slate-50 border-b last:border-b-0 text-left min-h-[44px] transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground font-mono truncate">{p.code}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
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
                <div className="text-center py-8 text-muted-foreground">
                  <ShoppingCart className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                  <div className="text-sm">Scan or search a product to start.</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {cart.map(item => (
                    <div key={item.productId} className="border rounded p-2.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{item.name}</div>
                          <div className="text-xs text-muted-foreground font-mono truncate">{item.code}</div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {!item.isSerialized && (
                            <>
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => updateQty(item.productId, item.qty - 1)} aria-label="Decrease quantity">
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="font-mono w-8 text-center text-sm">{item.qty}</span>
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => updateQty(item.productId, item.qty + 1)} aria-label="Increase quantity">
                                <Plus className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                          {item.isSerialized && <Badge variant="secondary" className="text-xs">{item.serials.length} serials</Badge>}
                          <span className="font-mono text-sm w-20 text-right">৳ {item.lineTotal.toFixed(2)}</span>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeFromCart(item.productId)} aria-label="Remove item">
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
                          aria-label={`Serial numbers for ${item.name}`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: checkout panel (desktop) */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader><CardTitle className="text-base">Checkout</CardTitle></CardHeader>
            <CardContent className="space-y-4">
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

              <div className="space-y-3 pt-2 border-t">
                <div className="space-y-1.5">
                  <Label htmlFor="warehouse-id" className="text-xs">Warehouse ID *</Label>
                  <Input id="warehouse-id" placeholder="Warehouse UUID" value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shift-id" className="text-xs">Cashier Shift ID (optional)</Label>
                  <Input id="shift-id" placeholder="Shift UUID" value={cashierShiftId} onChange={e => setCashierShiftId(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payment-method" className="text-xs">Payment Method</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger id="payment-method" className="text-xs"><SelectValue /></SelectTrigger>
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
                <div className="space-y-1.5">
                  <Label htmlFor="fin-account-id" className="text-xs">Financial Account ID *</Label>
                  <Input id="fin-account-id" placeholder="Account UUID" value={financialAccountId} onChange={e => setFinancialAccountId(e.target.value)} className="text-xs" />
                </div>
              </div>

              <Button onClick={handleCheckout} disabled={posting || cart.length === 0} className="w-full min-h-[44px]" size="lg">
                {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CreditCard className="h-4 w-4 mr-2" />}
                Complete Sale — ৳ {grandTotal.toFixed(2)}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Sticky mobile cart total bar */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 md:hidden bg-white border-t shadow-lg">
          <div className="flex items-center justify-between p-3 gap-3">
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">
                {cart.length} item{cart.length !== 1 ? 's' : ''} • <button className="text-primary underline" onClick={() => setCart([])}>Clear</button>
              </div>
              <div className="text-lg font-bold font-mono">৳ {grandTotal.toFixed(2)}</div>
            </div>
            <Button onClick={handleCheckout} disabled={posting} className="min-h-[44px] flex-shrink-0">
              {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CreditCard className="h-4 w-4 mr-2" />}
              Checkout
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
