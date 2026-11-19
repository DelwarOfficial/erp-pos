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
import { QuickCreateCustomer, type CreatedCustomer } from '@/components/customers/QuickCreateCustomer';
import { useDashboardSession } from '@/components/dashboard/session';
import { OfflineSaleScreen, OfflineTillPanel, useOnline } from '@/components/pos/OfflineTill';

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
  /** The product's selling price as text, exactly as the server sent it. */
  unitPriceText: string;
  /** Line discount in taka, as typed (empty = none). */
  discount: string;
  serials: string[];
  isSerialized: boolean;
  lineTotal: number;
}

/** Server-priced line (POST /api/v1/sales/pricing). */
interface PricedLine { product_id: string; gross_amount: string; discount_amount: string; tax_amount: string; line_total: string }
interface QuoteResult { grand_total: string; paid_now: string; unpaid: string; schedule: { installment_no: number; due_date: string; amount: string }[] }
type Timing = 'full' | 'part' | 'later';
type ScheduleMode = 'due' | 'equal' | 'custom';

// Money on this screen is exact: taka strings converted to whole paisa.
// Floating point never decides what is owed; the server computes every total
// and schedule, and these helpers only check and display.
const MONEY_RE = /^\d{1,15}(\.\d{1,2})?$/;
const HUNDRED = BigInt(100);
function toPaisa(value: string | number): bigint | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(2) : '') : value.trim();
  if (!MONEY_RE.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  return BigInt(whole) * HUNDRED + BigInt((frac + '00').slice(0, 2));
}
function fromPaisa(p: bigint): string {
  const negative = p < BigInt(0); const a = negative ? -p : p;
  return `${negative ? '-' : ''}${a / HUNDRED}.${String(a % HUNDRED).padStart(2, '0')}`;
}
/** part/whole as a percentage for display, rounded half-up to 2 places; never fed back into money. */
function percentText(part: bigint, whole: bigint): string | null {
  if (whole <= BigInt(0) || part <= BigInt(0)) return null;
  const scaled = (part * BigInt(10000) * BigInt(2) + whole) / (whole * BigInt(2)); // percent × 100
  const text = `${scaled / HUNDRED}.${String(scaled % HUNDRED).padStart(2, '0')}`.replace(/\.?0+$/, '');
  return `${text}%`;
}
const isoIn = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

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
// A split payment can also be a gift card, identified by its code.
// and, for a registered customer, reward points (1 point = ৳1, whole points).
const SPLIT_METHODS = [...PAYMENT_METHODS, 'gift_card', 'reward_points'] as const;

export default function POSPage() {
  const session = useDashboardSession();
  // Add a customer without leaving the sale (needs customer.create; never granted here).
  const canCreateCustomer = Boolean(session?.is_global || session?.permissions.includes('customer.create'));
  const [addCustomer, setAddCustomer] = useState<{ prefill: string } | null>(null);
  const t = useTranslations('pos');
  const f = useFormat();
  // With the connection down, a registered till takes cash sales into its queue.
  const online = useOnline();
  const canRegisterTill = Boolean(session?.is_global || session?.permissions.includes('device.register'));
  // Display helpers only: neither value is sent with the sale.
  const [cashReceived, setCashReceived] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [customer, setCustomer] = useState<(CreatedCustomer & { is_active?: boolean }) | null>(null);
  const [primaryAmount, setPrimaryAmount] = useState('');
  const [tenders, setTenders] = useState<{ id: string; method: string; account: BusinessEntity | null; amount: string; code?: string }[]>([]);
  const [postedSale, setPostedSale] = useState<{ saleId: string; referenceNo: string; grandTotal: string } | null>(null);
  const [pricing, setPricing] = useState<{ signature: string; subtotal: string; discount_total: string; tax_total: string; grand_total: string; lines: PricedLine[]; coupon?: { code: string; name: string; discount: string } | null } | null>(null);
  // When the customer pays: all now, part now, or all later. Separate from how they pay.
  const [timing, setTiming] = useState<Timing>('full');
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('due');
  const [dueDate, setDueDate] = useState(isoIn(30));
  const [installmentCount, setInstallmentCount] = useState('3');
  const [firstDue, setFirstDue] = useState(isoIn(30));
  const [intervalKind, setIntervalKind] = useState<'months' | 'days'>('months');
  const [intervalValue, setIntervalValue] = useState('1');
  const [customRows, setCustomRows] = useState<{ id: string; due_date: string; amount: string }[]>(() => [
    { id: crypto.randomUUID(), due_date: isoIn(30), amount: '' }, { id: crypto.randomUUID(), due_date: isoIn(60), amount: '' }]);
  const [reminders, setReminders] = useState(true);
  const [schedulePreview, setSchedulePreview] = useState<{ signature: string; quote: QuoteResult | null; error: string } | null>(null);
  const [revised, setRevised] = useState<{ from: string; to: string } | null>(null);
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
  // A coupon is opened on demand; most sales have none.
  const [couponOpen, setCouponOpen] = useState(false);
  // Products to tap without typing (touch tills): the first active ones.
  const [quickProducts, setQuickProducts] = useState<Product[]>([]);
  useEffect(() => {
    let active = true;
    apiFetch('/api/v1/products?limit=12&is_active=true').then(r => r.ok ? r.json() : null)
      .then(d => { if (active && d) setQuickProducts(d.items ?? []); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A discount that is not a valid amount is left out of pricing and blocks checkout.
  const discountOf = (item: CartItem) => item.discount.trim() === '' ? BigInt(0) : toPaisa(item.discount);
  // A coupon is priced by the server with the cart; posting applies the same code.
  const [couponInput, setCouponInput] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [points, setPoints] = useState<{ customerId: string; points: number; next_expiry: string | null } | null>(null);
  const cartPayload = JSON.stringify({ items: cart.map(item => {
    const d = discountOf(item);
    return { product_id: item.productId, qty: item.qty, unit_price: item.unitPrice, ...(d && d > BigInt(0) ? { discount_amount: Number(fromPaisa(d)) } : {}) };
  }), ...(couponCode ? { coupon_code: couponCode } : {}) });
  const pricingReady = pricing?.signature === cartPayload;
  const subtotal = pricingReady ? Number(pricing.subtotal) : cart.reduce((sum, item) => sum + item.lineTotal, 0);
  const discountTotal = pricingReady ? Number(pricing.discount_total) : 0;
  const taxTotal = pricingReady ? Number(pricing.tax_total) : 0;
  const grandTotal = pricingReady ? Number(pricing.grand_total) : subtotal;
  const grandPaisa = pricingReady ? toPaisa(Number(pricing.grand_total).toFixed(2)) ?? BigInt(0) : BigInt(0);
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

  // Old "Sell on credit" links arrive as ?pay=later (or ?pay=part).
  useEffect(() => {
    const pay = new URLSearchParams(window.location.search).get('pay');
    if (pay === 'later' || pay === 'part') setTiming(pay);
  }, []);

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
    // The product's selling price from the server (never its cost); the
    // server re-prices it, with tax, before anything is shown as final.
    const price = parseFloat(product.default_price);
    setCart(prev => [...prev, {
      productId: product.id,
      name: product.name,
      code: product.code,
      qty: 1,
      unitPrice: price,
      unitPriceText: product.default_price,
      discount: '',
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

  // The payments for the chosen timing. Only what that timing uses is sent:
  // a paid-now amount typed before switching to "Pay later" is not.
  const paymentsFor = useCallback(() => {
    if (timing === 'later') return [];
    const primary = timing === 'full' && primaryAmount === '' ? (pricingReady ? Number(pricing!.grand_total) : 0) : Number(primaryAmount);
    return [{ payment_method: paymentMethod, amount: primary, financial_account_id: financialAccountId },
      ...tenders.map(tender => tender.method === 'gift_card'
        // The card is the tender; the drawer account only files the payment record.
        ? { payment_method: 'gift_card', amount: Number(tender.amount), financial_account_id: financialAccountId, method_reference: tender.code?.trim() ?? '' }
        // Points are the tender too; the drawer account only files the record.
        : tender.method === 'reward_points'
        ? { payment_method: 'reward_points', amount: Number(tender.amount), financial_account_id: financialAccountId }
        : { payment_method: tender.method, amount: Number(tender.amount), financial_account_id: tender.account?.id ?? '' })];
  }, [timing, primaryAmount, pricingReady, pricing, paymentMethod, financialAccountId, tenders]);

  const paidPaisa = paymentsFor().reduce<bigint | null>((sum, p) => { const v = toPaisa(p.amount); return sum === null || v === null ? null : sum + v; }, BigInt(0));
  const remainingPaisa = paidPaisa === null ? null : grandPaisa - paidPaisa;

  // The schedule for what is left. The server splits and checks it; equal
  // installments are never divided here.
  const arrangement = useCallback(() => {
    if (timing === 'full') return undefined;
    if (scheduleMode === 'due') return { type: 'due', due_date: dueDate };
    if (scheduleMode === 'equal') return { type: 'equal', count: Number(installmentCount), first_due_date: firstDue,
      ...(intervalKind === 'days' ? { interval_days: Number(intervalValue) } : { interval_months: Number(intervalValue) }) };
    return { type: 'installments', installments: customRows.map(row => ({ due_date: row.due_date, amount: row.amount.trim() })) };
  }, [timing, scheduleMode, dueDate, installmentCount, firstDue, intervalKind, intervalValue, customRows]);

  // The customer's spendable points, shown when paying with them. A 404/403
  // (loyalty off, no permission) just hides the balance.
  const usesPoints = tenders.some(tender => tender.method === 'reward_points');
  useEffect(() => {
    if (!usesPoints || !customer?.id || points?.customerId === customer.id) return;
    let active = true;
    void apiFetch(`/api/v1/customers/${customer.id}/points`).then(async response => {
      if (!response.ok || !active) return;
      const data = await response.json();
      setPoints({ customerId: customer.id, points: Number(data.points), next_expiry: data.next_expiry ?? null });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [usesPoints, customer?.id, points?.customerId]);

  // The customer's consent to spend points: a code texted to their phone,
  // checked by the server and tied to this customer, these points and this
  // cart. Any change to them means a new code (the server would refuse the old one).
  const pointsTotal = tenders.filter(tender => tender.method === 'reward_points').reduce((sum, tender) => sum + (Number(tender.amount) || 0), 0);
  const saleItemsForIntent = cart.map(c => { const d = discountOf(c); return { product_id: c.productId, qty: c.qty, unit_price: c.unitPrice, ...(d && d > BigInt(0) ? { discount_amount: Number(fromPaisa(d)) } : {}) }; });
  const pointsIntent = usesPoints && customer?.id ? JSON.stringify({ customer: customer.id, points: pointsTotal, items: saleItemsForIntent, coupon: couponCode }) : '';
  const [pointsConfirm, setPointsConfirm] = useState<{ intent: string; id: string; phone: string; verified: boolean } | null>(null);
  const [pointsCode, setPointsCode] = useState('');
  const [pointsBusy, setPointsBusy] = useState<'' | 'send' | 'verify'>('');
  const [pointsError, setPointsError] = useState('');
  const confirmedPoints = pointsConfirm && pointsConfirm.intent === pointsIntent && pointsConfirm.verified ? pointsConfirm.id : null;
  const sendPointsCode = async () => {
    if (!customer?.id || pointsBusy) return;
    setPointsBusy('send'); setPointsError(''); setPointsCode('');
    try {
      const response = await apiFetch(`/api/v1/customers/${customer.id}/points/confirmations`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `points-code-${crypto.randomUUID()}` },
        body: JSON.stringify({ points: pointsTotal, items: saleItemsForIntent, ...(couponCode ? { coupon_code: couponCode } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? response.statusText);
      setPointsConfirm({ intent: pointsIntent, id: data.confirmation_id, phone: data.phone_masked, verified: false });
      setTimeout(() => document.getElementById('points-code')?.focus(), 0);
    } catch (cause) { setPointsError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPointsBusy(''); }
  };
  const verifyPointsCode = async () => {
    if (!customer?.id || !pointsConfirm || pointsBusy) return;
    setPointsBusy('verify'); setPointsError('');
    try {
      const response = await apiFetch(`/api/v1/customers/${customer.id}/points/confirmations/${pointsConfirm.id}/verify`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `points-verify-${crypto.randomUUID()}` }, body: JSON.stringify({ code: pointsCode }) });
      const data = await response.json();
      if (response.ok && data.verified) { setPointsConfirm({ ...pointsConfirm, verified: true }); return; }
      throw new Error(data?.error?.message ?? t('points_code_wrong', { left: data.attempts_left ?? 0 }));
    } catch (cause) { setPointsError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPointsBusy(''); }
  };

  const saleBody = useCallback(() => ({
    branch_id: branchId,
    warehouse_id: warehouseId,
    cashier_shift_id: cashierShiftId || undefined,
    customer_id: customer?.id,
    currency_code: 'BDT',
    exchange_rate: 1,
    items: cart.map(c => {
      const d = discountOf(c);
      return { product_id: c.productId, qty: c.qty, unit_price: c.unitPrice,
        ...(d && d > BigInt(0) ? { discount_amount: Number(fromPaisa(d)) } : {}),
        serials: c.isSerialized ? c.serials : undefined };
    }),
    payments: paymentsFor(),
    ...(couponCode ? { coupon_code: couponCode } : {}),
    ...(confirmedPoints ? { points_confirmation_id: confirmedPoints } : {}),
    ...(timing === 'full' ? {} : { payment_arrangement: arrangement(), due_reminders_enabled: reminders }),

  }), [branchId, warehouseId, cashierShiftId, customer, cart, paymentsFor, couponCode, confirmedPoints, timing, arrangement, reminders]);

  /** What is wrong with the sale before it can be sent, or null. */
  const saleProblem = useCallback((): string | null => {
    if (cart.length === 0) return t('err.cart_empty');
    if (!warehouseId || !branchId) return t('err.warehouse');
    if (!pricingReady) return t('err.pricing');
    for (const item of cart) {
      if (item.qty <= 0 || (item.isSerialized && (item.serials.length !== item.qty || new Set(item.serials).size !== item.qty))) {
        return t('err.serials', { name: item.name, count: Math.max(item.qty, 1) });
      }
      if (discountOf(item) === null) return t('err.discount_format', { name: item.name });
    }
    if (timing !== 'full' && !customer) return t('err.credit_customer');
    const payments = paymentsFor();
    if (payments.length && !financialAccountId) return t('err.account');
    if (payments.some(payment => !payment.financial_account_id || toPaisa(payment.amount) === null || payment.amount <= 0
        || (payment.payment_method === 'gift_card' && !('method_reference' in payment && payment.method_reference)))) return t('err.tenders');
    if (payments.some(payment => payment.payment_method === 'reward_points') && (!customer
        || payments.some(payment => payment.payment_method === 'reward_points' && !Number.isInteger(payment.amount)))) return t('err.points');
    if (payments.some(payment => payment.payment_method === 'reward_points') && !confirmedPoints) return t('err.points_confirm');
    if (remainingPaisa === null) return t('err.tenders');
    if (timing === 'full' && remainingPaisa !== BigInt(0)) return t('err.tenders');
    if (timing === 'part' && (remainingPaisa <= BigInt(0) || remainingPaisa >= grandPaisa)) return t('err.part_amount');
    if (timing !== 'full' && scheduleMode === 'custom' && customRows.some(row => !row.due_date || toPaisa(row.amount) === null)) return t('err.custom_rows');
    return null;
   
  }, [cart, warehouseId, branchId, pricingReady, timing, customer, paymentsFor, financialAccountId, remainingPaisa, grandPaisa, scheduleMode, customRows, confirmedPoints, t]);

  // Schedule preview: the server's own quote of this exact sale, refreshed
  // whenever the cart, discounts, amount paid now or schedule change.
  const previewSignature = timing === 'full' ? '' : JSON.stringify(saleBody());
  const previewProblem = timing === 'full' ? null : saleProblem();
  useEffect(() => {
    if (timing === 'full' || previewProblem) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const r = await apiFetch('/api/v1/sales/quote', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `quote-${crypto.randomUUID()}` }, body: previewSignature });
        const data = await r.json();
        if (!active) return;
        setSchedulePreview(r.ok ? { signature: previewSignature, quote: data, error: '' } : { signature: previewSignature, quote: null, error: data?.error?.message ?? t('err.save_generic') });
      } catch { if (active) setSchedulePreview({ signature: previewSignature, quote: null, error: t('err.network') }); }
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [timing, previewSignature, previewProblem, t]);
  const preview = schedulePreview?.signature === previewSignature ? schedulePreview : null;

  const handleCheckout = useCallback(async (confirmedTotal?: string) => {
    if (posting) return;
    const problem = saleProblem();
    if (problem) { toast.error(problem); return; }

    setPosting(true);
    try {
      const payload = JSON.stringify(saleBody());
      // Re-check the price on the server right before posting. If it moved
      // since the cart was priced, show the new total and wait for a yes.
      const shownTotal = pricing!.grand_total;
      if (confirmedTotal === undefined) {
        const q = await apiFetch('/api/v1/sales/quote', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `quote-${crypto.randomUUID()}` }, body: payload });
        const quote = await q.json();
        if (!q.ok) { toast.error(t('err.save', { reason: quote?.error?.message ?? t('err.save_generic') })); return; }
        if (toPaisa(Number(quote.grand_total).toFixed(2)) !== toPaisa(Number(shownTotal).toFixed(2))) {
          setRevised({ from: shownTotal, to: quote.grand_total }); setPricingAttempt(value => value + 1); return;
        }
      }
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
      setCart([]); setCashReceived(''); setTiming('full'); setSchedulePreview(null);
    } catch {
      // The request may have reached the server. Say so instead of inviting a blind retry.
      toast.error(t('err.network'));
    } finally {
      setPosting(false);
    }
  }, [posting, saleProblem, saleBody, pricing, t, f]);

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
      if (addCustomer) return;
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
  }, [cart, posting, search, handleCheckout, addCustomer]);

  const canReadSales = session?.is_global || session?.permissions.includes('sale.read');
  const canReadShifts = session?.is_global || session?.permissions.includes('shift.read');
  const cashReceivedNumber = Number(cashReceived);
  const cashDue = paymentMethod === 'cash' ? (primaryAmount === '' ? grandTotal : Number(primaryAmount)) : 0;
  const changeDue = cashReceived !== '' && Number.isFinite(cashReceivedNumber) ? cashReceivedNumber - cashDue : null;

  if (!online) return <OfflineSaleScreen />;

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

      {/* Where this sale happens: set once per shift, not part of each sale. */}
      <section aria-label={t('place_label')} className="rounded-lg border bg-card p-3">
        {optionsError && (
          <div className="space-y-2 border border-destructive/30 bg-destructive/10 rounded-md p-2.5">
            <p role="alert" className="text-sm text-foreground">{t('options_failed', { reason: optionsError })}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => setOptionsAttempt(attempt => attempt + 1)}>{t('options_retry')}</Button>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="warehouse-id">{t('warehouse')}<span aria-hidden="true" className="text-destructive"> *</span></Label>
            <Select
              value={warehouseId}
              onValueChange={handleWarehouseChange}
              disabled={optionsLoading || !!optionsError || warehouses.length === 0}
              required
            >
              <SelectTrigger id="warehouse-id" className="w-full" aria-required="true" >
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
        </div>
      </section>

      <OfflineTillPanel branchId={branchId} warehouseId={warehouseId} canRegister={canRegisterTill}
        cashAccountId={financialAccounts.find(account => account.id === financialAccountId)?.account_type === 'cash' ? financialAccountId : ''} />

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

              {/* Quick add: tap a product without searching. */}
              {!search.trim() && quickProducts.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <h3 className="text-xs font-medium text-muted-foreground">{t('quick_add')}</h3>
                  <div role="group" aria-label={t('quick_add')} className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {quickProducts.map(p => (
                      <button key={p.id} type="button" onClick={() => addToCart(p)}
                        className="flex min-h-16 flex-col justify-between rounded-md border bg-background p-2.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] motion-reduce:active:scale-100">
                        <span className="line-clamp-2 font-medium">{p.name}</span>
                        <span className="mt-1 flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
                          <span className="tabular-nums">{f.money(p.default_price)}</span>
                          {p.is_serialized ? <Badge variant="secondary" className="text-[10px]">{t('needs_serial')}</Badge> : null}
                        </span>
                      </button>
                    ))}
                  </div>
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
                    // Server figures for this line once priced; the percentage is shown, never sent.
                    const pricedLine = pricingReady ? pricing!.lines?.find(line => line.product_id === item.productId) : undefined;
                    const unitPaisa = toPaisa(item.unitPriceText) ?? BigInt(0);
                    const grossPaisa = unitPaisa * BigInt(Math.round(item.qty));
                    const discountPaisa = discountOf(item);
                    const discountTooBig = discountPaisa !== null && discountPaisa > grossPaisa;
                    const discountPercent = discountPaisa !== null && !discountTooBig ? percentText(discountPaisa, grossPaisa) : null;
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
                          <span className="min-w-24 text-right font-semibold tabular-nums">{f.money(pricedLine?.line_total ?? item.lineTotal)}</span>
                          <Button type="button" size="icon" variant="ghost" className="size-11" onClick={() => removeFromCart(item.productId)} aria-label={t('remove_item', { name: item.name })} title={t('remove_item', { name: item.name })}>
                            <Trash2 className="text-destructive" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                        <div className="space-y-1">
                          <Label htmlFor={`discount-${item.productId}`} className="text-xs">{t('line_discount')}</Label>
                          <div className="flex items-center gap-2">
                            <Input id={`discount-${item.productId}`} inputMode="decimal" autoComplete="off" placeholder="0" className="h-11 max-w-40 text-base tabular-nums"
                              value={item.discount} onChange={e => setCart(prev => prev.map(c => c.productId === item.productId ? { ...c, discount: e.target.value.trim() } : c))}
                              aria-invalid={discountPaisa === null || discountTooBig} aria-describedby={`discount-help-${item.productId}`} />
                            {discountPercent ? <span className="text-sm tabular-nums text-muted-foreground">{t('line_discount_percent', { percent: discountPercent })}</span> : null}
                          </div>
                          <p id={`discount-help-${item.productId}`} className={`text-xs ${discountPaisa === null || discountTooBig ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {discountPaisa === null ? t('line_discount_invalid') : discountTooBig ? t('line_discount_too_big') : t('line_discount_help')}
                          </p>
                        </div>
                        <dl className="grid grid-cols-[auto_auto] gap-x-3 text-xs tabular-nums sm:text-right">
                          <dt className="text-muted-foreground">{t('line_original', { qty: item.qty, price: f.money(item.unitPriceText) })}</dt><dd>{f.money(pricedLine?.gross_amount ?? fromPaisa(grossPaisa))}</dd>
                          <dt className="text-muted-foreground">{t('line_discount_short')}</dt><dd>{pricedLine ? `− ${f.money(pricedLine.discount_amount)}` : '—'}</dd>
                          <dt className="text-muted-foreground">{t('vat')}</dt><dd>{pricedLine ? f.money(pricedLine.tax_amount) : '—'}</dd>
                          <dt className="font-medium">{t('line_final')}</dt><dd className="font-medium">{pricedLine ? f.money(pricedLine.line_total) : t('pricing_wait_short')}</dd>
                        </dl>
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

        {/* Right: payment — who, how, then the total and the button. */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base"><h2>{t('payment_title')}</h2></CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <EntityPicker label={t(timing === 'full' ? 'customer_label' : 'customer_label_required')} endpoint="/api/v1/customers" value={customer} onChange={setCustomer} disabled={posting}
                      searchPlaceholder={t('customer_search_placeholder')}
                      selectPlaceholder={t('customer_select')}
                      searchLabel={t('customer_search_label')} noResultsLabel={t('customer_no_results')} loadingLabel={t('customer_search_loading')} retryLabel={t('add_customer_retry_search')}
                      getOptionDescription={item => [item.phone, item.is_active === false ? t('customer_inactive') : ''].filter(Boolean).join(' · ')}
                      getOptionDisabled={item => item.is_active === false}
                      createAction={canCreateCustomer ? { label: t('add_customer'), onCreate: prefill => setAddCustomer({ prefill }) } : undefined} />
                  </div>
                  {canCreateCustomer ? <Button type="button" variant="outline" disabled={posting} className="min-h-11 h-auto whitespace-normal text-left sm:max-w-44" onClick={() => setAddCustomer({ prefill: '' })}>{t('add_customer')}</Button> : null}
                </div>
                {/* Only the customer changes here; the cart, discounts, payments and schedule stay as they are,
                    and the schedule preview re-checks credit for the newly chosen customer. */}
                <QuickCreateCustomer open={canCreateCustomer && addCustomer !== null} onOpenChange={open => { if (!open) setAddCustomer(null); }} prefill={addCustomer?.prefill ?? ''}
                  onSelected={setCustomer} />
                {customer && timing === 'full' ? <Button type="button" variant="ghost" disabled={posting} onClick={() => setCustomer(null)}>{t('customer_clear')}</Button> : !customer ? <p className={`text-xs ${timing !== 'full' ? 'text-destructive' : 'text-muted-foreground'}`}>{timing !== 'full' ? t('err.credit_customer') : t('customer_walk_in')}</p> : null}
                {timing !== 'later' && <>
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
                </>}

              {timing !== 'later' && (
              <div className="space-y-3 border-t pt-3">
                {timing === 'full' && tenders.length === 0 ? (
                  <p className="text-sm text-muted-foreground" role="status">{pricingReady ? t('paid_in_full_note', { amount: f.money(grandTotal) }) : t('amount_wait')}</p>
                ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="primary-payment-amount">{t(timing === 'part' ? 'amount_part' : 'amount_now')}{timing === 'part' ? <span aria-hidden="true" className="text-destructive"> *</span> : null}</Label>
                  <Input id="primary-payment-amount" type="number" inputMode="decimal" min="0" step="any" className="h-12 text-base tabular-nums" aria-describedby="amount-now-help"
                    placeholder={timing === 'part' ? '0' : pricingReady ? String(grandTotal) : t('amount_wait')} value={primaryAmount} onChange={e => setPrimaryAmount(e.target.value)} />
                  <p id="amount-now-help" className="text-xs text-muted-foreground text-pretty">{t(timing === 'part' ? 'amount_part_help' : 'amount_now_help')}</p>
                </div>
                )}
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
                      {SPLIT_METHODS.map(method => <option key={method} value={method}>{t(`method_${method}`)}</option>)}
                    </select>
                    {tender.method === 'gift_card' ? (
                      <>
                        <Label htmlFor={`tender-code-${tender.id}`}>{t('split_gift_code')}</Label>
                        <Input id={`tender-code-${tender.id}`} autoComplete="off" className="h-11 text-base" value={tender.code ?? ''} onChange={e => setTenders(current => current.map(row => row.id === tender.id ? { ...row, code: e.target.value } : row))} />
                      </>
                    ) : tender.method === 'reward_points' ? (
                      <p role="status" className="text-sm text-muted-foreground">
                        {!customer ? t('points_need_customer')
                          : points?.customerId === customer.id ? t('points_balance', { points: points.points, value: f.money(points.points) })
                          : t('points_loading')}
                      </p>
                    ) : (
                      <EntityPicker label={t('split_account', { n: index + 1 })} endpoint={`/api/v1/financial-accounts?is_active=true${branchId ? `&branch_id=${branchId}` : ''}`} serverSearch={false} value={tender.account} onChange={account => setTenders(current => current.map(row => row.id === tender.id ? { ...row, account } : row))} />
                    )}
                    <Label htmlFor={`tender-amount-${tender.id}`}>{t(tender.method === 'reward_points' ? 'split_points' : 'split_amount')}</Label>
                    <Input id={`tender-amount-${tender.id}`} type="number" inputMode="decimal" min="0" step="any" className="h-11 text-base tabular-nums" value={tender.amount} onChange={e => setTenders(current => current.map(row => row.id === tender.id ? { ...row, amount: e.target.value } : row))} />
                    {tender.method === 'reward_points' && customer && pointsTotal > 0 ? (
                      <div className="space-y-2 rounded-md bg-muted/40 p-2.5" aria-live="polite">
                        {confirmedPoints ? (
                          <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-success-foreground"><CheckCircle2 className="size-4" aria-hidden="true" />{t('points_confirmed', { points: pointsTotal })}</p>
                        ) : pointsConfirm && pointsConfirm.intent === pointsIntent ? (
                          <>
                            <Label htmlFor="points-code">{t('points_code_label', { phone: pointsConfirm.phone })}</Label>
                            <div className="flex gap-2">
                              <Input id="points-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="h-11 flex-1 text-base tabular-nums tracking-widest"
                                value={pointsCode} onChange={e => setPointsCode(e.target.value.replace(/\D/g, ''))} aria-describedby="points-code-error"
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void verifyPointsCode(); } }} />
                              <Button type="button" className="min-h-11" disabled={pointsCode.length !== 6 || !!pointsBusy} onClick={() => void verifyPointsCode()}>
                                {pointsBusy === 'verify' ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}{t('points_code_confirm')}</Button>
                            </div>
                            <Button type="button" variant="ghost" size="sm" className="min-h-9 px-2" disabled={!!pointsBusy} onClick={() => void sendPointsCode()}>{t('points_code_resend')}</Button>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-muted-foreground">{t('points_consent_help')}</p>
                            <Button type="button" variant="outline" className="min-h-11" disabled={!!pointsBusy || !Number.isInteger(pointsTotal)} onClick={() => void sendPointsCode()}>
                              {pointsBusy === 'send' ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}{t('points_code_send')}</Button>
                          </>
                        )}
                        {pointsError ? <p id="points-code-error" role="alert" className="text-sm text-destructive">{pointsError}</p> : null}
                      </div>
                    ) : null}
                    <Button variant="outline" type="button" onClick={() => setTenders(current => current.filter(row => row.id !== tender.id))}>{t('split_remove', { n: index + 1 })}</Button>
                  </div>
                ))}
                <Button type="button" variant="ghost" size="sm" className="min-h-10 px-2" onClick={() => setTenders(current => [...current, { id: crypto.randomUUID(), method: 'card', account: null, amount: '' }])}><Plus aria-hidden="true" />{t('split_add')}</Button>
              </div>
              )}
                {/* When the customer pays — separate from how they pay. */}
                <div className="space-y-1.5" role="radiogroup" aria-labelledby="timing-label">
                  <span id="timing-label" className="text-sm font-medium leading-none text-muted-foreground">{t('timing')}</span>
                  <div className="grid grid-cols-3 gap-2">
                    {(['full', 'part', 'later'] as const).map(option => (
                      <button key={option} type="button" role="radio" aria-checked={timing === option}
                        onClick={() => setTiming(option)}
                        className={`min-h-10 rounded-md border px-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${timing === option ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'}`}>
                        {t(`timing_${option}`)}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground text-pretty">{t(`timing_${timing}_help`)}</p>
                </div>

              <div className="space-y-2">
                {couponOpen || couponCode ? (
                <form className="space-y-1.5" onSubmit={e => { e.preventDefault(); setCouponCode(couponInput.trim().toUpperCase()); }}>
                  <Label htmlFor="coupon-code">{t('coupon_label')}</Label>
                  <div className="flex gap-2">
                    <Input id="coupon-code" autoComplete="off" className="h-11 flex-1 text-base uppercase" value={couponInput} disabled={posting} aria-describedby="coupon-status"
                      onChange={e => setCouponInput(e.target.value)} />
                    {couponCode
                      ? <Button type="button" variant="outline" className="min-h-11" disabled={posting} onClick={() => { setCouponCode(''); setCouponInput(''); }}>{t('coupon_remove')}</Button>
                      : <Button type="submit" variant="outline" className="min-h-11" disabled={posting || !couponInput.trim()}>{t('coupon_apply')}</Button>}
                  </div>
                  <p id="coupon-status" role="status" className="text-sm text-muted-foreground">
                    {couponCode && pricingReady && pricing!.coupon ? t('coupon_applied', { name: pricing!.coupon.name, amount: f.money(pricing!.coupon.discount) }) : couponCode && !pricingError ? t('coupon_checking') : ''}
                  </p>
                </form>
                ) : (
                  <Button type="button" variant="ghost" size="sm" className="min-h-10 px-2" onClick={() => { setCouponOpen(true); setTimeout(() => document.getElementById('coupon-code')?.focus(), 0); }}>
                    <Plus aria-hidden="true" />{t('coupon_open')}
                  </Button>
                )}
              </div>
              {timing !== 'full' && (
                <section aria-labelledby="schedule-title" className="space-y-3 border-t pt-3">
                  <h3 id="schedule-title" className="text-sm font-semibold">{t('schedule_title')}</h3>
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="schedule-title">
                    {(['due', 'equal', 'custom'] as const).map(option => (
                      <button key={option} type="button" role="radio" aria-checked={scheduleMode === option} onClick={() => setScheduleMode(option)}
                        className={`min-h-11 rounded-md border px-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${scheduleMode === option ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'}`}>
                        {t(`schedule_${option}`)}
                      </button>
                    ))}
                  </div>
                  {scheduleMode === 'due' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="due-date">{t('schedule_due_date')}</Label>
                      <Input id="due-date" type="date" className="h-11" min={isoIn(0)} value={dueDate} onChange={e => setDueDate(e.target.value)} />
                    </div>
                  )}
                  {scheduleMode === 'equal' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5"><Label htmlFor="inst-count">{t('schedule_count')}</Label>
                        <Input id="inst-count" type="number" inputMode="numeric" min="1" max="60" className="h-11" value={installmentCount} onChange={e => setInstallmentCount(e.target.value)} /></div>
                      <div className="space-y-1.5"><Label htmlFor="inst-first">{t('schedule_first_due')}</Label>
                        <Input id="inst-first" type="date" className="h-11" min={isoIn(0)} value={firstDue} onChange={e => setFirstDue(e.target.value)} /></div>
                      <div className="space-y-1.5"><Label htmlFor="inst-interval-kind">{t('schedule_interval')}</Label>
                        <select id="inst-interval-kind" className="h-11 w-full rounded-md border bg-background px-2 text-base" value={intervalKind}
                          onChange={e => { const kind = e.target.value as 'months' | 'days'; setIntervalKind(kind); setIntervalValue(kind === 'days' ? '30' : '1'); }}>
                          <option value="months">{t('schedule_interval_months')}</option>
                          <option value="days">{t('schedule_interval_days')}</option>
                        </select></div>
                      <div className="space-y-1.5"><Label htmlFor="inst-interval">{t(intervalKind === 'days' ? 'schedule_every_days' : 'schedule_every_months')}</Label>
                        <Input id="inst-interval" type="number" inputMode="numeric" min="1" max={intervalKind === 'days' ? 365 : 12} className="h-11" value={intervalValue} onChange={e => setIntervalValue(e.target.value)} /></div>
                      <p className="text-xs text-muted-foreground text-pretty sm:col-span-2">{t(intervalKind === 'days' ? 'schedule_days_help' : 'schedule_months_help')}</p>
                    </div>
                  )}
                  {scheduleMode === 'custom' && (
                    <div className="space-y-2">
                      {customRows.map((row, index) => (
                        <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                          <div className="space-y-1"><Label htmlFor={`row-date-${row.id}`} className="text-xs">{t('schedule_row_date', { n: index + 1 })}</Label>
                            <Input id={`row-date-${row.id}`} type="date" className="h-11" value={row.due_date} onChange={e => setCustomRows(rows => rows.map(r => r.id === row.id ? { ...r, due_date: e.target.value } : r))} /></div>
                          <div className="space-y-1"><Label htmlFor={`row-amount-${row.id}`} className="text-xs">{t('schedule_row_amount', { n: index + 1 })}</Label>
                            <Input id={`row-amount-${row.id}`} inputMode="decimal" className="h-11 tabular-nums" value={row.amount} aria-invalid={row.amount !== '' && toPaisa(row.amount) === null}
                              onChange={e => setCustomRows(rows => rows.map(r => r.id === row.id ? { ...r, amount: e.target.value.trim() } : r))} /></div>
                          <Button type="button" variant="ghost" size="icon" className="size-11" disabled={customRows.length === 1} aria-label={t('schedule_row_remove', { n: index + 1 })}
                            onClick={() => setCustomRows(rows => rows.filter(r => r.id !== row.id))}><Trash2 aria-hidden="true" /></Button>
                        </div>
                      ))}
                      {(() => {
                        // Never changed for you: the difference is shown, and filling it is a click.
                        const entered = customRows.reduce<bigint | null>((sum, r) => { const v = toPaisa(r.amount); return sum === null || v === null ? null : sum + v; }, BigInt(0));
                        const gap = entered !== null && remainingPaisa !== null ? remainingPaisa - entered : null;
                        return (
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            {gap !== null && gap !== BigInt(0) ? <span role="status" className="text-destructive tabular-nums">{t(gap > BigInt(0) ? 'schedule_gap_short' : 'schedule_gap_over', { amount: f.money(fromPaisa(gap > BigInt(0) ? gap : -gap)) })}</span>
                              : gap !== null ? <span role="status" className="text-muted-foreground">{t('schedule_gap_ok')}</span> : null}
                            <Button type="button" variant="outline" size="sm" onClick={() => setCustomRows(rows => [...rows, { id: crypto.randomUUID(), due_date: rows.length ? rows[rows.length - 1].due_date : isoIn(30), amount: '' }])}>{t('schedule_row_add')}</Button>
                            {gap !== null && gap !== BigInt(0) && customRows.length > 0 ? (
                              <Button type="button" variant="outline" size="sm" onClick={() => {
                                const others = customRows.slice(0, -1).reduce((sum, r) => sum + (toPaisa(r.amount) ?? BigInt(0)), BigInt(0));
                                const last = remainingPaisa! - others;
                                if (last > BigInt(0)) setCustomRows(rows => rows.map((r, i) => i === rows.length - 1 ? { ...r, amount: fromPaisa(last) } : r));
                              }}>{t('schedule_fill_last')}</Button>
                            ) : null}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={reminders} onChange={e => setReminders(e.target.checked)} />{t('schedule_reminders')}</label>
                  {preview?.error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm">{preview.error}</p> : null}
                  {preview?.quote?.schedule?.length ? (
                    <div className="overflow-x-auto"><table className="w-full text-sm tabular-nums"><caption className="sr-only">{t('schedule_preview')}</caption>
                      <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1">#</th><th>{t('schedule_col_date')}</th><th className="text-right">{t('schedule_col_amount')}</th></tr></thead>
                      <tbody>{preview.quote.schedule.map(row => <tr key={row.installment_no} className="border-b last:border-0"><td className="py-1">{row.installment_no}</td><td>{f.date(row.due_date)}</td><td className="text-right">{f.money(row.amount)}</td></tr>)}</tbody>
                    </table></div>
                  ) : !preview && !previewProblem ? <p role="status" className="text-xs text-muted-foreground">{t('schedule_checking')}</p> : null}
                </section>
              )}
                {cart.length > 0 && !pricingReady && !pricingError ? <p role="status" className="text-sm text-muted-foreground">{t('pricing_wait')}</p> : null}
                {pricingError ? <div role="alert" className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm"><p>{t('pricing_failed', { reason: pricingError })}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setPricingAttempt(value => value + 1)}>{t('pricing_retry')}</Button>{couponCode ? <Button type="button" variant="outline" onClick={() => { setCouponCode(''); setCouponInput(''); }}>{t('coupon_remove')}</Button> : null}</div></div> : null}
              <dl className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm" aria-label={t('summary_label')}>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t('subtotal')}</dt>
                  <dd className="tabular-nums">{f.money(subtotal)}</dd>
                </div>
                {(() => {
                  // The server's discount total includes the coupon; the coupon has its own row below.
                  const couponPaisa = pricingReady && pricing!.coupon ? toPaisa(Number(pricing!.coupon.discount).toFixed(2)) ?? BigInt(0) : BigInt(0);
                  const linePaisa = (pricingReady ? toPaisa(Number(pricing!.discount_total).toFixed(2)) ?? BigInt(0) : BigInt(0)) - couponPaisa;
                  if (discountTotal <= 0 || linePaisa <= BigInt(0)) return null;
                  const p = percentText(linePaisa, toPaisa(Number(pricing!.subtotal).toFixed(2)) ?? BigInt(0));
                  return (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">{t('discount_total')}</dt>
                      <dd className="tabular-nums">− {f.money(fromPaisa(linePaisa))}{p ? ` (${p})` : ''}</dd>
                    </div>
                  );
                })()}
                {pricingReady && pricing!.coupon ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t('coupon_line', { code: pricing!.coupon.code })}</dt>
                    <dd className="tabular-nums">− {f.money(pricing!.coupon.discount)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t('vat')}</dt>
                  <dd className="tabular-nums">{f.money(taxTotal)}</dd>
                </div>
                <div className="flex items-baseline justify-between border-t pt-2">
                  <dt className="text-base font-semibold">{t('total')}</dt>
                  <dd className="text-2xl font-bold tabular-nums">{f.money(grandTotal)}</dd>
                </div>
                {timing !== 'full' || tenders.length > 0 ? <>
                  <div className="flex justify-between"><dt>{t('paid_now')}</dt><dd className="tabular-nums">{f.money(paidPaisa === null ? '0' : fromPaisa(paidPaisa))}</dd></div>
                  <div className="flex justify-between"><dt className="font-medium">{t('remaining_due')}</dt>
                    <dd className={`font-semibold tabular-nums ${remainingPaisa !== null && remainingPaisa > BigInt(0) ? 'text-destructive' : ''}`}>{f.money(remainingPaisa === null || remainingPaisa < BigInt(0) ? '0' : fromPaisa(remainingPaisa))}</dd></div>
                </> : null}
              </dl>
              {previewProblem && timing !== 'full' && cart.length > 0 ? <p className="text-xs text-muted-foreground" role="status">{previewProblem}</p> : null}
              <Button type="button" onClick={() => void handleCheckout()} disabled={posting || cart.length === 0 || !pricingReady || !!optionsError} className="w-full min-h-14 text-base" size="lg">
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
            <Button type="button" onClick={() => void handleCheckout()} disabled={posting || !pricingReady || !!optionsError} className="min-h-12 flex-shrink-0 px-5 text-base">
              {posting ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CreditCard aria-hidden="true" />}
              {posting ? t('completing') : t('complete_short')}
            </Button>
          </div>
        </div>
      )}

      {/* The price changed between pricing the cart and posting: show the new total first. */}
      <AlertDialog open={revised !== null} onOpenChange={open => { if (!open) setRevised(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('revised_title')}</AlertDialogTitle>
            <AlertDialogDescription>{revised ? t('revised_body', { from: f.money(revised.from), to: f.money(revised.to) }) : null}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('revised_cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={!pricingReady} onClick={() => { const to = revised?.to; setRevised(null); void handleCheckout(to); }}>{t('revised_confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
