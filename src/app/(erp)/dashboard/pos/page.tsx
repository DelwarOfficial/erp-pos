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
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/components/i18n/I18nProvider';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Search, ShoppingCart, Trash2, Plus, Minus, CreditCard, Loader2, PackageX, AlertCircle, CheckCircle2, Printer, FileText } from 'lucide-react';
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

const PAYMENT_METHODS = ['cash', 'card', 'bkash', 'nagad', 'rocket', 'bank_transfer'] as const;

export default function POSPage() {
  const session = useDashboardSession();
  const t = useTranslations('pos');
  const f = useFormat();
  // Display helpers only: neither value is sent with the sale.
  const [cashReceived, setCashReceived] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
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
        const response = await apiFetch('/api/v1/sales/pricing', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `pricing-${crypto.randomUUID()}` }, body: cartPayload, signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? t('err.options'));
        if (active) setPricing({ ...data, signature: cartPayload });
      } catch (cause) { if (active) setPricingError(cause instanceof Error ? cause.message : t('err.options')); }
    }, 200);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [cartPayload, pricingAttempt, t]);

  // Fetch dropdown options on mount.
  useEffect(() => {
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError(null);
    Promise.all([
      apiFetch('/api/v1/warehouses').then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d?.error?.message ?? t('err.options'));
        }
        return r.json();
      }),
      apiFetch('/api/v1/financial-accounts').then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d?.error?.message ?? t('err.options'));
        }
        return r.json();
      }),
      apiFetch('/api/v1/cashier-shifts?status=open').then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d?.error?.message ?? t('err.options'));
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
        const msg = e instanceof Error ? e.message : t('err.options');
        setOptionsError(msg);
        toast.error(t('options_failed', { reason: msg }));
      })
      .finally(() => { if (!cancelled) setOptionsLoading(false); });
    return () => { cancelled = true; };
  }, [optionsAttempt, t]);

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
            throw new Error(d?.error?.message ?? t('err.search'));
          }
          return r.json();
        })
        .then(d => { setProducts(d.items ?? []); setHasSearched(true); })
        .catch(e => { setSearchError(e instanceof Error ? e.message : t('err.search')); setProducts([]); })
        .finally(() => setSearching(false));
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, searchAttempt, t]);

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
    if (cart.length === 0) { toast.error(t('err.cart_empty')); return; }
    if (!warehouseId || !branchId) { toast.error(t('err.warehouse')); return; }
    if (!pricingReady) { toast.error(t('err.pricing')); return; }
    if (!financialAccountId) { toast.error(t('err.account')); return; }
    for (const item of cart) {
      if (item.qty <= 0 || (item.isSerialized && (item.serials.length !== item.qty || new Set(item.serials).size !== item.qty))) {
        toast.error(t('err.serials', { name: item.name, count: Math.max(item.qty, 1) }));
        return;
      }
    }
    const payments = [{ payment_method: paymentMethod, amount: primaryAmount === '' ? grandTotal : Number(primaryAmount), financial_account_id: financialAccountId },
      ...tenders.map(tender => ({ payment_method: tender.method, amount: Number(tender.amount), financial_account_id: tender.account?.id ?? '' }))];
    if (payments.some(payment => !payment.financial_account_id || !Number.isFinite(payment.amount) || payment.amount <= 0)
      || Math.abs(payments.reduce((sum, payment) => sum + payment.amount, 0) - grandTotal) > 0.00000001) {
      toast.error(t('err.tenders')); return;
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
        toast.error(t('err.save', { reason: data?.error?.message ?? t('err.save_generic') }));
        return;
      }
      toast.success(t('saved_toast', { ref: data.referenceNo, amount: f.money(data.grandTotal) }));
      setPostedSale(data); saleRetry.current = null; setPrimaryAmount(''); setTenders([]); setCustomer(null);
      setCart([]); setCashReceived('');
    } catch {
      // The request may have reached the server. Say so instead of inviting a blind retry.
      toast.error(t('err.network'));
    } finally {
      setPosting(false);
    }
  }, [cart, warehouseId, branchId, cashierShiftId, paymentMethod, financialAccountId, grandTotal, pricingReady, posting, primaryAmount, tenders, customer, t, f]);

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

  const canReadSales = session?.is_global || session?.permissions.includes('sale.read');
  const canReadShifts = session?.is_global || session?.permissions.includes('shift.read');
  const cashReceivedNumber = Number(cashReceived);
  const cashDue = paymentMethod === 'cash' ? (primaryAmount === '' ? grandTotal : Number(primaryAmount)) : 0;
  const changeDue = cashReceived !== '' && Number.isFinite(cashReceivedNumber) ? cashReceivedNumber - cashDue : null;

  return (
    <fieldset disabled={posting} className="min-w-0 space-y-4 pb-28 md:pb-4">
      {postedSale ? (
        <Card className="border-success/40 bg-success/5">
          <CardHeader><CardTitle><h2 className="flex items-center gap-2 text-lg"><CheckCircle2 className="size-5 text-success-foreground" aria-hidden="true" />{t('saved_title', { ref: postedSale.referenceNo })}</h2></CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p role="status" className="text-sm text-pretty">{t('saved_body', { amount: f.money(postedSale.grandTotal) })}</p>
            <div className="flex flex-wrap gap-2">
              {canReadSales ? <>
                <Button size="lg" asChild><a href={`/print/receipt/${postedSale.saleId}`} target="_blank" rel="noopener noreferrer"><Printer aria-hidden="true" />{t('print_receipt')}</a></Button>
                <Button size="lg" variant="outline" asChild><a href={`/print/invoice/${postedSale.saleId}`} target="_blank" rel="noopener noreferrer"><FileText aria-hidden="true" />{t('print_invoice')}</a></Button>
              </> : null}
              <Button size="lg" variant={canReadSales ? 'ghost' : 'default'} onClick={() => { setPostedSale(null); searchInputRef.current?.focus(); }}>{t('next_sale')}</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ShoppingCart className="h-6 w-6" aria-hidden="true" /> {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm text-pretty">
          {t('subtitle')}
          <span className="hidden md:inline ml-2 text-xs">
            <kbd className="px-1.5 py-0.5 border rounded bg-muted">Enter</kbd> {t('shortcut_checkout')}
            <kbd className="px-1.5 py-0.5 border rounded bg-muted ml-2">Esc</kbd> {t('shortcut_clear')}
          </span>
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: product search + cart */}
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <Card>
            <CardHeader><CardTitle className="text-base"><h2>{t('find_title')}</h2></CardTitle></CardHeader>
            <CardContent>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" aria-hidden="true" />
                <Input
                  ref={searchInputRef}
                  placeholder={t('search_placeholder')}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="h-12 pl-11 text-base"
                  autoComplete="off"
                  autoFocus
                  inputMode="search"
                  enterKeyHint="search"
                  aria-label={t('search_label')}
                  aria-describedby="pos-search-hint"
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin motion-reduce:animate-none text-muted-foreground" aria-hidden="true" />
                )}
              </div>
              <p id="pos-search-hint" className="mt-1.5 text-xs text-muted-foreground">{t('search_hint')}</p>

              {/* Search error state */}
              {searchError && (
                <div role="alert" className="mt-2 flex items-center gap-2 text-sm text-foreground bg-destructive/10 border border-destructive/30 rounded-md p-2.5">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 text-destructive" aria-hidden="true" />
                  <span className="flex-1">{t('search_failed', { reason: searchError })}</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => setSearchAttempt(attempt => attempt + 1)}>{t('try_again')}</Button>
                </div>
              )}

              {/* Loading skeleton */}
              {searching && (
                <div className="mt-2 border rounded-md divide-y" role="status" aria-busy="true" aria-label={t('searching')}>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="p-3 flex items-center justify-between animate-pulse motion-reduce:animate-none">
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
                <div className="mt-2 border rounded-md p-6 text-center text-muted-foreground flex flex-col items-center gap-2">
                  <PackageX className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                  <div className="text-sm text-pretty">{t('no_match', { query: search })}</div>
                  <Button type="button" variant="outline" onClick={() => { setSearch(''); searchInputRef.current?.focus(); }}>{t('clear_search')}</Button>
                </div>
              )}

              {/* Results list */}
              {!searching && !searchError && products.length > 0 && (
                <div className="mt-2 border rounded-md max-h-80 overflow-y-auto" role="group" aria-label={t('results_label')}>
                  {products.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addToCart(p)}
                      className="w-full flex items-center justify-between gap-3 p-3 hover:bg-accent focus-visible:bg-accent border-b last:border-b-0 text-left min-h-14 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{p.code}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {p.is_serialized && <Badge variant="secondary" className="text-xs">{t('needs_serial')}</Badge>}
                        <span className="font-medium tabular-nums">{f.money(p.default_price)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base"><h2>{t('cart_title', { count: cart.length })}</h2></CardTitle>
              {cart.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>{t('clear_cart')}</Button>}
            </CardHeader>
            <CardContent>
              {cart.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <ShoppingCart className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" aria-hidden="true" />
                  <div className="text-sm text-pretty">{t('cart_empty')}</div>
                </div>
              ) : (
                <ul className="space-y-2">
                  {cart.map(item => {
                    const serialsMissing = item.isSerialized && item.serials.length === 0;
                    const serialsDuplicate = item.isSerialized && new Set(item.serials).size !== item.serials.length;
                    return (
                    <li key={item.productId} className="border rounded-md p-3 space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{item.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{item.code} · {f.money(item.unitPrice)} {t('each')}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {!item.isSerialized && (
                            <>
                              <Button type="button" size="icon" variant="outline" className="size-11" onClick={() => updateQty(item.productId, item.qty - 1)} aria-label={t('decrease')}>
                                <Minus aria-hidden="true" />
                              </Button>
                              <span className="w-10 text-center font-medium tabular-nums" aria-label={t('quantity_of', { qty: item.qty, name: item.name })}>{item.qty}</span>
                              <Button type="button" size="icon" variant="outline" className="size-11" onClick={() => updateQty(item.productId, item.qty + 1)} aria-label={t('increase')}>
                                <Plus aria-hidden="true" />
                              </Button>
                            </>
                          )}
                          {item.isSerialized && <Badge variant="secondary" className="text-xs">{t('serial_count', { count: item.serials.length })}</Badge>}
                          <span className="min-w-24 text-right font-semibold tabular-nums">{f.money(item.lineTotal)}</span>
                          <Button type="button" size="icon" variant="ghost" className="size-11" onClick={() => removeFromCart(item.productId)} aria-label={t('remove_item', { name: item.name })} title={t('remove_item', { name: item.name })}>
                            <Trash2 className="text-destructive" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                      {item.isSerialized && (
                        <div className="space-y-1">
                          <Label htmlFor={`serials-${item.productId}`} className="text-xs">{t('serial_label', { name: item.name })}</Label>
                          <Input
                            id={`serials-${item.productId}`}
                            placeholder={t('serial_placeholder')}
                            value={item.serials.join(', ')}
                            onChange={e => updateSerials(item.productId, e.target.value)}
                            autoComplete="off"
                            aria-invalid={serialsMissing || serialsDuplicate}
                            aria-describedby={`serials-help-${item.productId}`}
                          />
                          <p id={`serials-help-${item.productId}`} className={`text-xs ${serialsDuplicate ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {serialsDuplicate ? t('serial_duplicate') : serialsMissing ? t('serial_missing') : t('serial_help')}
                          </p>
                        </div>
                      )}
                    </li>
                  ); })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: payment panel */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader><CardTitle className="text-base"><h2>{t('payment_title')}</h2></CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t('subtotal')}</dt>
                  <dd className="tabular-nums">{f.money(subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t('vat')}</dt>
                  <dd className="tabular-nums">{f.money(taxTotal)}</dd>
                </div>
                <div className="flex items-baseline justify-between border-t pt-2">
                  <dt className="text-base font-semibold">{t('total')}</dt>
                  <dd className="text-2xl font-bold tabular-nums">{f.money(grandTotal)}</dd>
                </div>
              </dl>

              <div className="space-y-3 pt-2 border-t">
                {cart.length > 0 && !pricingReady && !pricingError ? <p role="status" className="text-sm text-muted-foreground">{t('pricing_wait')}</p> : null}
                {pricingError ? <div role="alert" className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm"><p>{t('pricing_failed', { reason: pricingError })}</p><Button type="button" variant="outline" onClick={() => setPricingAttempt(value => value + 1)}>{t('pricing_retry')}</Button></div> : null}
                <EntityPicker label={t('customer_label')} endpoint="/api/v1/customers" value={customer} onChange={setCustomer} disabled={posting} />
                {customer ? <Button type="button" variant="ghost" onClick={() => setCustomer(null)}>{t('customer_clear')}</Button> : <p className="text-xs text-muted-foreground">{t('customer_walk_in')}</p>}
                {optionsError && (
                  <div className="space-y-2 border border-destructive/30 bg-destructive/10 rounded-md p-2.5">
                    <p role="alert" className="text-sm text-foreground">{t('options_failed', { reason: optionsError })}</p>
                    <Button type="button" size="sm" variant="outline" onClick={() => setOptionsAttempt(attempt => attempt + 1)}>{t('options_retry')}</Button>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="warehouse-id">{t('warehouse')}<span aria-hidden="true" className="text-destructive"> *</span></Label>
                  <Select
                    value={warehouseId}
                    onValueChange={handleWarehouseChange}
                    disabled={optionsLoading || !!optionsError || warehouses.length === 0}
                    required
                  >
                    <SelectTrigger id="warehouse-id" className="w-full" aria-required="true" aria-describedby="warehouse-help">
                      <SelectValue
                        placeholder={
                          optionsLoading ? t('loading') :
                          warehouses.length === 0 ? t('warehouse_none') :
                          t('warehouse_placeholder')
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map(w => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name} ({w.code}){w.branch ? ` · ${w.branch.name}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p id="warehouse-help" className="text-xs text-muted-foreground">{t('warehouse_help')}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shift-id">{t('shift')}</Label>
                  <Select
                    value={cashierShiftId}
                    onValueChange={setCashierShiftId}
                    disabled={optionsLoading || cashierShifts.length === 0}
                  >
                    <SelectTrigger id="shift-id" className="w-full" aria-describedby={!optionsLoading && cashierShifts.length === 0 ? 'shift-help' : undefined}>
                      <SelectValue
                        placeholder={
                          optionsLoading ? t('loading') :
                          cashierShifts.length === 0 ? t('shift_none') :
                          t('shift_placeholder')
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {cashierShifts.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.cashier?.name ?? t('shift_unknown_cashier')} · {f.dateTime(s.opened_at)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!optionsLoading && !optionsError && cashierShifts.length === 0 && (
                    <p id="shift-help" className="text-xs text-muted-foreground text-pretty">
                      {t('shift_none_help')}{' '}
                      {canReadShifts && <Link href="/dashboard/cashier" className="font-medium text-foreground underline underline-offset-4">{t('shift_open_link')}</Link>}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5" role="radiogroup" aria-labelledby="payment-method-label">
                  <span id="payment-method-label" className="text-sm font-medium leading-none">{t('method')}</span>
                  <div className="grid grid-cols-3 gap-2">
                    {PAYMENT_METHODS.map(method => (
                      <button key={method} type="button" role="radio" aria-checked={paymentMethod === method}
                        onClick={() => setPaymentMethod(method)}
                        className={`min-h-12 rounded-md border px-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97] motion-reduce:active:scale-100 ${paymentMethod === method ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'}`}>
                        {t(`method_${method}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fin-account-id">{t('account')}<span aria-hidden="true" className="text-destructive"> *</span></Label>
                  <Select
                    value={financialAccountId}
                    onValueChange={setFinancialAccountId}
                    disabled={optionsLoading || !!optionsError || financialAccounts.length === 0}
                    required
                  >
                    <SelectTrigger id="fin-account-id" className="w-full" aria-required="true" aria-describedby="account-help">
                      <SelectValue
                        placeholder={
                          optionsLoading ? t('loading') :
                          financialAccounts.length === 0 ? t('account_none') :
                          t('account_placeholder')
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {financialAccounts.map(a => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} ({a.account_type.replaceAll('_', ' ')})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p id="account-help" className="text-xs text-muted-foreground">{t('account_help')}</p>
                </div>
              </div>

              <div className="space-y-3 border-t pt-3">
                <div className="space-y-1.5">
                  <Label htmlFor="primary-payment-amount">{t('amount_now')}</Label>
                  <Input id="primary-payment-amount" type="number" inputMode="decimal" min="0" step="any" className="h-12 text-base tabular-nums" aria-describedby="amount-now-help"
                    placeholder={pricingReady ? String(grandTotal) : t('amount_wait')} value={primaryAmount} onChange={e => setPrimaryAmount(e.target.value)} />
                  <p id="amount-now-help" className="text-xs text-muted-foreground text-pretty">{t('amount_now_help')}</p>
                </div>
                {paymentMethod === 'cash' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="cash-received">{t('cash_received')}</Label>
                    <Input id="cash-received" type="number" inputMode="decimal" min="0" step="any" className="h-12 text-base tabular-nums" value={cashReceived} onChange={e => setCashReceived(e.target.value)} aria-describedby="cash-change" />
                    <p id="cash-change" role="status" className={`text-sm tabular-nums ${changeDue !== null && changeDue < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {changeDue === null ? t('cash_change_hint') : changeDue < 0 ? t('cash_short', { amount: f.money(-changeDue) }) : t('cash_change', { amount: f.money(changeDue) })}
                    </p>
                  </div>
                )}
                {tenders.map((tender, index) => (
                  <div key={tender.id} className="space-y-2 rounded-md border p-3">
                    <h3 className="text-sm font-medium">{t('split_title', { n: index + 1 })}</h3>
                    <Label htmlFor={`tender-method-${tender.id}`}>{t('split_method')}</Label>
                    <select id={`tender-method-${tender.id}`} className="h-11 w-full rounded-md border bg-background px-2 text-base" value={tender.method} onChange={e => setTenders(current => current.map(row => row.id === tender.id ? { ...row, method: e.target.value } : row))}>
                      {PAYMENT_METHODS.map(method => <option key={method} value={method}>{t(`method_${method}`)}</option>)}
                    </select>
                    <EntityPicker label={t('split_account', { n: index + 1 })} endpoint={`/api/v1/financial-accounts?is_active=true${branchId ? `&branch_id=${branchId}` : ''}`} serverSearch={false} value={tender.account} onChange={account => setTenders(current => current.map(row => row.id === tender.id ? { ...row, account } : row))} />
                    <Label htmlFor={`tender-amount-${tender.id}`}>{t('split_amount')}</Label>
                    <Input id={`tender-amount-${tender.id}`} type="number" inputMode="decimal" min="0" step="any" className="h-11 text-base tabular-nums" value={tender.amount} onChange={e => setTenders(current => current.map(row => row.id === tender.id ? { ...row, amount: e.target.value } : row))} />
                    <Button variant="outline" type="button" onClick={() => setTenders(current => current.filter(row => row.id !== tender.id))}>{t('split_remove', { n: index + 1 })}</Button>
                  </div>
                ))}
                <Button type="button" variant="outline" className="w-full" onClick={() => setTenders(current => [...current, { id: crypto.randomUUID(), method: 'card', account: null, amount: '' }])}>{t('split_add')}</Button>
              </div>
              <Button type="button" onClick={handleCheckout} disabled={posting || cart.length === 0 || !pricingReady || !!optionsError} className="w-full min-h-14 text-base" size="lg">
                {posting ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CreditCard aria-hidden="true" />}
                {posting ? t('completing') : t('complete', { amount: f.money(grandTotal) })}
              </Button>
              {cart.length === 0 && <p className="text-center text-xs text-muted-foreground">{t('complete_hint')}</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Sticky mobile cart total bar */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 md:hidden bg-card border-t shadow-lg pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center justify-between p-3 gap-3">
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">{t('items_count', { count: cart.length })}</div>
              <div className="text-xl font-bold tabular-nums">{f.money(grandTotal)}</div>
            </div>
            <Button type="button" onClick={handleCheckout} disabled={posting || !pricingReady || !!optionsError} className="min-h-12 flex-shrink-0 px-5 text-base">
              {posting ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CreditCard aria-hidden="true" />}
              {posting ? t('completing') : t('complete_short')}
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('clear_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('clear_body', { count: cart.length })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('clear_keep')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setCart([]); setCashReceived(''); searchInputRef.current?.focus(); }}>{t('clear_confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </fieldset>
  );
}
