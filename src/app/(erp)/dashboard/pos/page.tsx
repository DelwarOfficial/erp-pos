// src/app/(erp)/dashboard/pos/page.tsx
// POS sale screen — scan/search products, build cart, checkout.
// - Responsive grid: 1 col mobile, 2 col tablet, 3-4 col desktop.
// - Cart is full-width on mobile (sticky total at bottom), side panel on desktop.
// - Loading / error / empty states for product search.
// - Keyboard shortcuts: Enter = checkout, Escape = clear search.
// - Warehouse / financial-account / cashier-shift are <Select> dropdowns
//   populated on mount from /api/v1/warehouses, /api/v1/financial-accounts,
//   /api/v1/cashier-shifts?status=open.

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
import { apiFetch } from '@/lib/api/client';
import { EntityPicker, type BusinessEntity } from '@/components/shared/EntityPicker';
import { useDashboardSession } from '@/components/dashboard/session';

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

interface WarehouseOption {
  id: string;
  name: string;
  code: string;
  warehouse_type?: string;
  branch?: { id: string; name: string; code: string } | null;
}

interface FinancialAccountOption {
  id: string;
  name: string;
  account_type: string;
  is_active: boolean;
}

interface CashierShiftOption {
  id: string;
  status: string;
  cashier: { id: string; name: string; email: string };
  branch: { id: string; name: string; code: string } | null;
  warehouse: { id: string; name: string; code: string } | null;
  opened_at: string;
}

export default function POSPage() {
  const session = useDashboardSession();
  const [customer, setCustomer] = useState<BusinessEntity | null>(null);
  const [primaryAmount, setPrimaryAmount] = useState('');
  const [tenders, setTenders] = useState<{ id: string; method: string; account: BusinessEntity | null; amount: string }[]>([]);
  const [postedSale, setPostedSale] = useState<{ saleId: string; referenceNo: string; grandTotal: string } | null>(null);
  const [pricing, setPricing] = useState<{ signature: string; subtotal: string; tax_total: string; grand_total: string } | null>(null);
  const [pricingError, setPricingError] = useState('');
  const [pricingAttempt, setPricingAttempt] = useState(0);
  const saleRetry = useRef<{ payload: string; key: string } | null>(null);
  const [search, setSearch] = useState('');
  const [searchAttempt, setSearchAttempt] = useState(0);
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

  // Dropdown option lists
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [financialAccounts, setFinancialAccounts] = useState<FinancialAccountOption[]>([]);
  const [cashierShifts, setCashierShifts] = useState<CashierShiftOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsAttempt, setOptionsAttempt] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cartPayload = JSON.stringify({ items: cart.map(item => ({ product_id: item.productId, qty: item.qty, unit_price: item.unitPrice })) });
  const pricingReady = pricing?.signature === cartPayload;
  const subtotal = pricingReady ? Number(pricing.subtotal) : cart.reduce((sum, item) => sum + item.lineTotal, 0);
  const taxTotal = pricingReady ? Number(pricing.tax_total) : 0;
  const grandTotal = pricingReady ? Number(pricing.grand_total) : subtotal;
  useEffect(() => {
    if (!JSON.parse(cartPayload).items.length) return;
    const controller = new AbortController(); let active = true;
    setPricingError('');
    const timer = setTimeout(async () => {
      try {
        const response = await apiFetch('/api/v1/sales/pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cartPayload, signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? 'Unable to price cart');
        if (active) setPricing({ ...data, signature: cartPayload });
      } catch (cause) { if (active) setPricingError(cause instanceof Error ? cause.message : 'Unable to price cart'); }
    }, 200);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [cartPayload, pricingAttempt]);

  // Fetch dropdown options on mount.
  useEffect(() => {
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError(null);
    Promise.all([
      apiFetch('/api/v1/warehouses').then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d?.error?.message ?? `Failed to load warehouses (HTTP ${r.status})`);
        }
        return r.json();
      }),
      apiFetch('/api/v1/financial-accounts').then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d?.error?.message ?? `Failed to load financial accounts (HTTP ${r.status})`);
        }
        return r.json();
      }),
      apiFetch('/api/v1/cashier-shifts?status=open').then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d?.error?.message ?? `Failed to load cashier shifts (HTTP ${r.status})`);
        }
        return r.json();
      }),
    ])
      .then(([wh, fa, cs]) => {
        if (cancelled) return;
        setWarehouses(wh.items ?? []);
        setFinancialAccounts((fa.items ?? []).filter((a: FinancialAccountOption) => a.is_active));
        setCashierShifts(cs.items ?? []);
        // Auto-pick first open shift if only one is available
        if ((cs.items ?? []).length === 1) {
          const s = cs.items[0];
          setCashierShiftId(s.id);
          if (s.branch?.id) setBranchId(s.branch.id);
          if (s.warehouse?.id) setWarehouseId(prev => prev || s.warehouse.id);
        }
      })
      .catch(e => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'Failed to load POS options';
        setOptionsError(msg);
        toast.error(msg);
      })
      .finally(() => { if (!cancelled) setOptionsLoading(false); });
    return () => { cancelled = true; };
  }, [optionsAttempt]);

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
      apiFetch(`/api/v1/products?search=${encodeURIComponent(search)}&limit=20&is_active=true`)
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
  }, [search, searchAttempt]);

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
    setCart(prev => prev.map(c => c.productId === productId ? { ...c, serials: serialArr, qty: serialArr.length, lineTotal: c.unitPrice * serialArr.length } : c));
  }

  function removeFromCart(productId: string) {
    setCart(prev => prev.filter(c => c.productId !== productId));
  }

  const handleCheckout = useCallback(async () => {
    if (posting) return;
    if (cart.length === 0) { toast.error('Cart is empty'); return; }
    if (!warehouseId || !branchId) { toast.error('Select a warehouse with a valid branch'); return; }
    if (!pricingReady) { toast.error('Wait for current cart pricing or retry pricing.'); return; }
    if (!financialAccountId) { toast.error('Financial account is required'); return; }
    for (const item of cart) {
      if (item.qty <= 0 || (item.isSerialized && (item.serials.length !== item.qty || new Set(item.serials).size !== item.qty))) {
        toast.error(`${item.name} requires ${item.qty} serial(s)`);
        return;
      }
    }
    const payments = [{ payment_method: paymentMethod, amount: primaryAmount === '' ? grandTotal : Number(primaryAmount), financial_account_id: financialAccountId },
      ...tenders.map(tender => ({ payment_method: tender.method, amount: Number(tender.amount), financial_account_id: tender.account?.id ?? '' }))];
    if (payments.some(payment => !payment.financial_account_id || !Number.isFinite(payment.amount) || payment.amount <= 0)
      || Math.abs(payments.reduce((sum, payment) => sum + payment.amount, 0) - grandTotal) > 0.00000001) {
      toast.error('Every tender needs an account and positive amount. Applied payments must equal the sale total.'); return;
    }

    setPosting(true);
    try {
      const payload = JSON.stringify({
          branch_id: branchId,
          warehouse_id: warehouseId,
          cashier_shift_id: cashierShiftId || undefined,
          customer_id: customer?.id,
          currency_code: 'BDT',
          exchange_rate: 1,
          items: cart.map(c => ({
            product_id: c.productId,
            qty: c.qty,
            unit_price: c.unitPrice,
            serials: c.isSerialized ? c.serials : undefined,
          })),
          payments,
        });
      if (saleRetry.current?.payload !== payload) saleRetry.current = { payload, key: crypto.randomUUID() };
      const res = await apiFetch('/api/v1/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': saleRetry.current.key },
        body: payload,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Sale failed');
        return;
      }
      toast.success(`Sale ${data.referenceNo} posted — ৳${Number(data.grandTotal).toFixed(2)}`);
      setPostedSale(data); saleRetry.current = null; setPrimaryAmount(''); setTenders([]); setCustomer(null);
      setCart([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setPosting(false);
    }
  }, [cart, warehouseId, branchId, cashierShiftId, paymentMethod, financialAccountId, grandTotal, pricingReady, posting, primaryAmount, tenders, customer]);

  // When the warehouse selection changes, derive the branch_id from the
  // warehouse's branch relation (if available).
  function handleWarehouseChange(id: string) {
    setWarehouseId(id);
    const wh = warehouses.find(w => w.id === id);
    setBranchId(wh?.branch?.id ?? '');
    setCashierShiftId(''); setFinancialAccountId('');
  }

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
      // Let focused controls and open overlays handle their own Enter action.
      const isInteractive = target?.closest('button, a, [role="button"], [role="combobox"], [role="menuitem"], [role="option"], [role="dialog"], [role="listbox"], [role="menu"]');
      if (e.key === 'Enter' && !e.defaultPrevented && !e.repeat && !e.isComposing && !isTypingField && !isInteractive && cart.length > 0 && !posting) {
        e.preventDefault();
        void handleCheckout();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cart, posting, search, handleCheckout]);

  return (
    <fieldset disabled={posting} className="min-w-0 space-y-4 pb-28 md:pb-4">
      {postedSale ? <Card><CardHeader><CardTitle><h2>Sale posted: {postedSale.referenceNo}</h2></CardTitle></CardHeader><CardContent className="space-y-3"><p role="status">Payment recorded. Total: BDT {Number(postedSale.grandTotal).toFixed(2)}</p>{session?.is_global || session?.permissions.includes('sale.read') ? <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><a href={`/print/invoice/${postedSale.saleId}`} target="_blank" rel="noopener noreferrer">Invoice / print</a></Button><Button variant="outline" asChild><a href={`/print/receipt/${postedSale.saleId}`} target="_blank" rel="noopener noreferrer">Receipt / print</a></Button></div> : null}<Button variant="ghost" onClick={() => setPostedSale(null)}>Dismiss confirmation</Button></CardContent></Card> : null}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingCart className="h-6 w-6" /> POS — Point of Sale
        </h1>
        <p className="text-muted-foreground text-sm">
          Scan or search products, build the cart, checkout with payment.
          <span className="hidden md:inline ml-2 text-xs">
            <kbd className="px-1.5 py-0.5 border rounded bg-muted">Enter</kbd> to checkout •
            <kbd className="px-1.5 py-0.5 border rounded bg-muted ml-1">Esc</kbd> to clear search
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
                  <Button size="sm" variant="ghost" onClick={() => setSearchAttempt(attempt => attempt + 1)}>Retry</Button>
                </div>
              )}

              {/* Loading skeleton */}
              {searching && (
                <div className="mt-2 border rounded divide-y" aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="p-2 flex items-center justify-between animate-pulse">
                      <div className="space-y-1.5">
                        <div className="h-3 w-40 bg-muted rounded" />
                        <div className="h-2 w-24 bg-muted rounded" />
                      </div>
                      <div className="h-4 w-16 bg-muted rounded" />
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
                <div className="mt-2 border rounded max-h-72 overflow-y-auto" role="group" aria-label="Product search results">
                  {products.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addToCart(p)}
                      className="w-full flex items-center justify-between p-2.5 hover:bg-muted border-b last:border-b-0 text-left min-h-[44px] transition-colors"
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
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{item.name}</div>
                          <div className="text-xs text-muted-foreground font-mono truncate">{item.code}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
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
                          <span className="font-mono text-sm min-w-20 text-right tabular-nums">৳ {item.lineTotal.toFixed(2)}</span>
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
                  <span className="text-muted-foreground">Tax</span>
                  <span className="font-mono">৳ {taxTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>Grand Total</span>
                  <span className="font-mono">৳ {grandTotal.toFixed(2)}</span>
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t">
                {cart.length > 0 && !pricingReady && !pricingError ? <p role="status" className="text-sm">Calculating current prices and tax…</p> : null}
                {pricingError ? <div role="alert" className="space-y-2 text-sm"><p>{pricingError}</p><Button type="button" variant="outline" onClick={() => setPricingAttempt(value => value + 1)}>Retry pricing</Button></div> : null}
                <EntityPicker label="Customer (optional)" endpoint="/api/v1/customers" value={customer} onChange={setCustomer} disabled={posting} />
                {customer ? <Button type="button" variant="ghost" onClick={() => setCustomer(null)}>Use walk-in customer</Button> : <p className="text-xs text-muted-foreground">Walk-in sale</p>}
                {optionsError && (
                  <div className="space-y-2 border border-destructive/20 bg-destructive/5 rounded p-2">
                    <p role="alert" className="text-sm text-foreground">{optionsError}</p>
                    <Button type="button" size="sm" variant="outline" onClick={() => setOptionsAttempt(attempt => attempt + 1)}>Retry checkout options</Button>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="warehouse-id" className="text-xs">Warehouse *</Label>
                  <Select
                    value={warehouseId}
                    onValueChange={handleWarehouseChange}
                    disabled={optionsLoading || !!optionsError || warehouses.length === 0}
                  >
                    <SelectTrigger id="warehouse-id" className="text-xs">
                      <SelectValue
                        placeholder={
                          optionsLoading ? 'Loading...' :
                          warehouses.length === 0 ? 'No warehouses' :
                          'Select warehouse'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map(w => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.code} - {w.name}
                          {w.branch ? ` (${w.branch.code})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shift-id" className="text-xs">Cashier Shift (optional)</Label>
                  <Select
                    value={cashierShiftId}
                    onValueChange={setCashierShiftId}
                    disabled={optionsLoading || cashierShifts.length === 0}
                  >
                    <SelectTrigger id="shift-id" className="text-xs">
                      <SelectValue
                        placeholder={
                          optionsLoading ? 'Loading...' :
                          cashierShifts.length === 0 ? 'No open shifts' :
                          'Select open shift'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {cashierShifts.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.cashier?.name ?? 'Unknown'} - {new Date(s.opened_at).toLocaleString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                  <Label htmlFor="fin-account-id" className="text-xs">Financial Account *</Label>
                  <Select
                    value={financialAccountId}
                    onValueChange={setFinancialAccountId}
                    disabled={optionsLoading || !!optionsError || financialAccounts.length === 0}
                  >
                    <SelectTrigger id="fin-account-id" className="text-xs">
                      <SelectValue
                        placeholder={
                          optionsLoading ? 'Loading...' :
                          financialAccounts.length === 0 ? 'No accounts' :
                          'Select account'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {financialAccounts.map(a => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} ({a.account_type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3 border-t pt-3"><div><Label htmlFor="primary-payment-amount">Applied payment amount</Label><Input id="primary-payment-amount" type="number" min="0" step="any" placeholder={pricingReady ? String(grandTotal) : 'Waiting for price'} value={primaryAmount} onChange={e => setPrimaryAmount(e.target.value)} /><p className="text-xs text-muted-foreground">Blank applies the full total. For split payment, enter each tender amount. Give cash change separately.</p></div>
                {tenders.map((tender, index) => <div key={tender.id} className="space-y-2 rounded-md border p-3"><h3 className="text-sm font-medium">Additional payment {index + 1}</h3><Label htmlFor={`tender-method-${tender.id}`}>Method</Label><select id={`tender-method-${tender.id}`} className="h-11 w-full rounded-md border bg-background px-2" value={tender.method} onChange={e => setTenders(current => current.map(row => row.id === tender.id ? { ...row, method: e.target.value } : row))}>{['cash', 'card', 'bkash', 'nagad', 'rocket', 'bank_transfer'].map(method => <option key={method} value={method}>{method.replaceAll('_', ' ')}</option>)}</select><EntityPicker label={`Account for payment ${index + 1}`} endpoint={`/api/v1/financial-accounts?is_active=true${branchId ? `&branch_id=${branchId}` : ''}`} serverSearch={false} value={tender.account} onChange={account => setTenders(current => current.map(row => row.id === tender.id ? { ...row, account } : row))} /><Label htmlFor={`tender-amount-${tender.id}`}>Amount</Label><Input id={`tender-amount-${tender.id}`} type="number" min="0" step="any" value={tender.amount} onChange={e => setTenders(current => current.map(row => row.id === tender.id ? { ...row, amount: e.target.value } : row))} /><Button variant="outline" type="button" onClick={() => setTenders(current => current.filter(row => row.id !== tender.id))}>Remove payment {index + 1}</Button></div>)}
                <Button type="button" variant="outline" onClick={() => setTenders(current => [...current, { id: crypto.randomUUID(), method: 'card', account: null, amount: '' }])}>Add split payment</Button>
              </div>
              <Button onClick={handleCheckout} disabled={posting || cart.length === 0 || !pricingReady || !!optionsError} className="w-full min-h-[44px]" size="lg">
                {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CreditCard className="h-4 w-4 mr-2" />}
                Complete Sale — ৳ {grandTotal.toFixed(2)}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Sticky mobile cart total bar */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 md:hidden bg-card border-t shadow-lg pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center justify-between p-3 gap-3">
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">
                {cart.length} item{cart.length !== 1 ? 's' : ''} • <button className="text-primary underline" onClick={() => setCart([])}>Clear</button>
              </div>
              <div className="text-lg font-bold font-mono">৳ {grandTotal.toFixed(2)}</div>
            </div>
            <Button onClick={handleCheckout} disabled={posting || !pricingReady || !!optionsError} className="min-h-[44px] flex-shrink-0">
              {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CreditCard className="h-4 w-4 mr-2" />}
              Checkout
            </Button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
