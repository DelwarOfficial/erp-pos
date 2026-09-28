// src/app/(erp)/dashboard/sales/credit/page.tsx
// Credit sale: a sale whose unpaid part is collected later, on a schedule.
// The server computes every total and the schedule: "Preview" asks
// POST /api/v1/sales/quote (nothing is stored), "Post sale" sends the same
// body to POST /api/v1/sales. Credit limits and overdue blocks are enforced there.

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiFetch } from '@/lib/api/client';
import { normalizeBdMobile, maskBdMobile } from '@/domain/receivables/phone';
import { newIdempotencyKey, readError, Taka } from '@/components/collections/common';

interface Option { id: string; name: string; code?: string; branch?: { id: string } | null }
interface Customer { id: string; name: string; phone: string | null; credit_limit: string }
interface Product { id: string; name: string; code: string; default_price: string }
interface Line { product: Product; qty: string; unit_price: string }
interface CustomRow { due_date: string; amount: string }
interface Quote {
  subtotal: string; discount_total: string; tax_total: string; grand_total: string; paid_now: string; unpaid: string;
  reminder_phone: string | null; schedule: { installment_no: number; due_date: string; amount: string }[];
}

const METHODS = ['cash', 'bkash', 'nagad', 'rocket', 'card', 'bank_transfer', 'cheque', 'other'];
const MONEY = /^\d{1,15}(\.\d{1,2})?$/;
const isoIn = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

async function list<T>(url: string): Promise<T[]> {
  const r = await apiFetch(url);
  if (!r.ok) return [];
  return (await r.json()).items ?? [];
}

export default function CreditSalePage() {
  const [branches, setBranches] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [accounts, setAccounts] = useState<Option[]>([]);
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');

  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [phone, setPhone] = useState('');
  const [reminders, setReminders] = useState(true);

  const [productQuery, setProductQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [lines, setLines] = useState<Line[]>([]);

  const [paidNow, setPaidNow] = useState('');
  const [method, setMethod] = useState('cash');
  const [accountId, setAccountId] = useState('');

  const [mode, setMode] = useState<'due' | 'equal' | 'custom'>('due');
  const [dueDate, setDueDate] = useState(isoIn(30));
  const [count, setCount] = useState('3');
  const [firstDue, setFirstDue] = useState(isoIn(30));
  const [interval, setInterval] = useState('1');
  const [custom, setCustom] = useState<CustomRow[]>([{ due_date: isoIn(30), amount: '' }, { due_date: isoIn(60), amount: 'rest' }]);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState<'quote' | 'post' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ saleId: string; referenceNo: string } | null>(null);
  // One key per attempt: a double click cannot post the sale twice.
  const [postKey, setPostKey] = useState(() => newIdempotencyKey('credit-sale'));

  useEffect(() => {
    void list<Option>('/api/v1/branches').then(b => { setBranches(b); if (b.length === 1) setBranchId(b[0].id); });
    void list<Option>('/api/v1/warehouses').then(setWarehouses);
    void list<Option>('/api/v1/financial-accounts').then(setAccounts);
  }, []);

  useEffect(() => {
    if (customerQuery.trim().length < 2) { setCustomers([]); return; }
    const t = setTimeout(() => { void list<Customer>(`/api/v1/customers?search=${encodeURIComponent(customerQuery.trim())}&limit=10`).then(setCustomers); }, 250);
    return () => clearTimeout(t);
  }, [customerQuery]);

  useEffect(() => {
    if (productQuery.trim().length < 2) { setProducts([]); return; }
    const t = setTimeout(() => { void list<Product>(`/api/v1/products?search=${encodeURIComponent(productQuery.trim())}&limit=10`).then(setProducts); }, 250);
    return () => clearTimeout(t);
  }, [productQuery]);

  const branchWarehouses = warehouses.filter(w => !branchId || !w.branch || w.branch.id === branchId);
  const branchAccounts = accounts.filter(a => !a.branch || a.branch.id === branchId);
  const canonical = normalizeBdMobile(phone);
  const phoneProblem = reminders && (phone.trim() === '' ? 'Enter the mobile number reminders go to, or turn reminders off.' : canonical ? null : 'Not a valid Bangladeshi mobile number (01XXXXXXXXX).');

  const body = useMemo(() => {
    const paid = paidNow.trim();
    const arrangement = mode === 'due' ? { type: 'due', due_date: dueDate }
      : mode === 'equal' ? { type: 'equal', count: Number(count), first_due_date: firstDue, interval_months: Number(interval) }
      : { type: 'installments', installments: custom.map(r => ({ due_date: r.due_date, amount: r.amount.trim() })) };
    return {
      branch_id: branchId, warehouse_id: warehouseId, customer_id: customer?.id,
      items: lines.map(l => ({ product_id: l.product.id, qty: Number(l.qty), unit_price: Number(l.unit_price) })),
      payments: paid && Number(paid) > 0 ? [{ payment_method: method, amount: Number(paid), financial_account_id: accountId }] : [],
      payment_arrangement: arrangement,
      reminder_phone: canonical ?? undefined,
      due_reminders_enabled: reminders,
    };
  }, [branchId, warehouseId, customer, lines, paidNow, method, accountId, mode, dueDate, count, firstDue, interval, custom, canonical, reminders]);

  // Any change makes the preview stale and the next post a new attempt.
  useEffect(() => { setQuote(null); setError(null); }, [body]);

  function localProblem(): string | null {
    if (!branchId || !warehouseId) return 'Choose the branch and warehouse.';
    if (!customer) return 'A credit sale needs a customer.';
    if (lines.length === 0) return 'Add at least one item.';
    if (lines.some(l => !(Number(l.qty) > 0) || !MONEY.test(l.unit_price))) return 'Every item needs a quantity and a price.';
    if (paidNow.trim() && (!MONEY.test(paidNow.trim()) || (Number(paidNow) > 0 && !accountId))) return 'Enter a valid amount paid now and the account it goes to.';
    if (mode === 'custom' && custom.some((r, i) => !r.due_date || !(MONEY.test(r.amount.trim()) || (r.amount.trim() === 'rest' && i === custom.length - 1)))) {
      return 'Each installment needs a date and an amount; only the last may be "rest".';
    }
    return phoneProblem || null;
  }

  async function send(kind: 'quote' | 'post') {
    const problem = localProblem();
    if (problem) { setError(problem); return; }
    setBusy(kind); setError(null);
    try {
      const r = await apiFetch(kind === 'quote' ? '/api/v1/sales/quote' : '/api/v1/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': kind === 'quote' ? newIdempotencyKey('sale-quote') : postKey },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await readError(r));
      const data = await r.json();
      if (kind === 'quote') { setQuote(data); return; }
      setPosted({ saleId: data.saleId, referenceNo: data.referenceNo });
      toast.success(`Sale ${data.referenceNo} posted`);
      setLines([]); setPaidNow(''); setQuote(null); setPostKey(newIdempotencyKey('credit-sale'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      if (kind === 'post') setPostKey(newIdempotencyKey('credit-sale'));
    } finally { setBusy(null); }
  }

  const setLine = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setRow = (i: number, patch: Partial<CustomRow>) => setCustom(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Credit sale</h1>
        <p className="text-sm text-muted-foreground">Sell now, collect later on agreed dates. The customer gets SMS reminders before and after each due date.</p>
      </div>
      {posted && (
        <Alert><AlertDescription>
          Sale <strong>{posted.referenceNo}</strong> posted. {customer && <Link className="underline" href={`/dashboard/collections/customers/${customer.id}`}>Open {customer.name}&apos;s collection profile</Link>}
        </AlertDescription></Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Customer</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="branch">Branch</Label>
                <Select value={branchId} onValueChange={v => { setBranchId(v); setWarehouseId(''); setAccountId(''); }}>
                  <SelectTrigger id="branch"><SelectValue placeholder="Choose a branch" /></SelectTrigger>
                  <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="warehouse">Warehouse</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger id="warehouse"><SelectValue placeholder="Choose a warehouse" /></SelectTrigger>
                  <SelectContent>{branchWarehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="relative space-y-1 md:col-span-2">
                <Label htmlFor="customer">Customer</Label>
                {customer ? (
                  <div className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <span><strong>{customer.name}</strong> · credit limit <Taka value={customer.credit_limit} /></span>
                    <Button variant="ghost" size="sm" onClick={() => { setCustomer(null); setPhone(''); }}>Change</Button>
                  </div>
                ) : (
                  <>
                    <Input id="customer" placeholder="Search by name or mobile" value={customerQuery} onChange={e => setCustomerQuery(e.target.value)} autoComplete="off" />
                    {customers.length > 0 && (
                      <ul className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow">
                        {customers.map(c => (
                          <li key={c.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                            onClick={() => { setCustomer(c); setPhone(c.phone ?? ''); setCustomerQuery(''); setCustomers([]); }}>
                            {c.name} <span className="text-muted-foreground">{c.phone}</span>
                          </button></li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="phone">Mobile for reminders</Label>
                <Input id="phone" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} aria-invalid={Boolean(phoneProblem)} />
                {phoneProblem ? <p className="text-xs text-destructive">{phoneProblem}</p>
                  : canonical && <p className="text-xs text-muted-foreground">Confirm with the customer: reminders go to {maskBdMobile(canonical)}.</p>}
              </div>
              <label className="flex items-center gap-3 self-end pb-2">
                <Switch checked={reminders} onCheckedChange={setReminders} /> <span className="text-sm">Send SMS due reminders</span>
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Items</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Input placeholder="Search products by name or code" value={productQuery} onChange={e => setProductQuery(e.target.value)} autoComplete="off" aria-label="Search products" />
                {products.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow">
                    {products.map(p => (
                      <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => { setLines(ls => [...ls, { product: p, qty: '1', unit_price: p.default_price }]); setProductQuery(''); setProducts([]); }}>
                        {p.name} <span className="text-muted-foreground">{p.code} · <Taka value={p.default_price} /></span>
                      </button></li>
                    ))}
                  </ul>
                )}
              </div>
              {lines.length > 0 && (
                <Table>
                  <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="w-24">Qty</TableHead><TableHead className="w-36">Unit price</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {lines.map((l, i) => (
                      <TableRow key={`${l.product.id}-${i}`}>
                        <TableCell>{l.product.name}</TableCell>
                        <TableCell><Input inputMode="decimal" value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} aria-label="Quantity" /></TableCell>
                        <TableCell><Input inputMode="decimal" value={l.unit_price} onChange={e => setLine(i, { unit_price: e.target.value })} aria-label="Unit price" /></TableCell>
                        <TableCell><Button variant="ghost" size="icon" aria-label="Remove item" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment and schedule</CardTitle>
              <CardDescription>What the customer pays now; the rest is collected on the dates below.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1"><Label htmlFor="paid">Paid now (৳)</Label><Input id="paid" inputMode="decimal" placeholder="0" value={paidNow} onChange={e => setPaidNow(e.target.value)} /></div>
                <div className="space-y-1">
                  <Label htmlFor="method">Method</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger id="method"><SelectValue /></SelectTrigger>
                    <SelectContent>{METHODS.map(m => <SelectItem key={m} value={m}>{m.replace('_', ' ')}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="account">Into account</Label>
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger id="account"><SelectValue placeholder="Choose" /></SelectTrigger>
                    <SelectContent>{branchAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mode">Unpaid part</Label>
                <Select value={mode} onValueChange={v => setMode(v as typeof mode)}>
                  <SelectTrigger id="mode" className="w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="due">All on one date</SelectItem>
                    <SelectItem value="equal">Equal installments</SelectItem>
                    <SelectItem value="custom">Custom installments</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {mode === 'due' && <div className="space-y-1"><Label htmlFor="due">Due date</Label><Input id="due" type="date" className="w-48" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>}
              {mode === 'equal' && (
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-1"><Label htmlFor="count">Installments</Label><Input id="count" type="number" min={1} max={60} value={count} onChange={e => setCount(e.target.value)} /></div>
                  <div className="space-y-1"><Label htmlFor="first">First due</Label><Input id="first" type="date" value={firstDue} onChange={e => setFirstDue(e.target.value)} /></div>
                  <div className="space-y-1"><Label htmlFor="interval">Every (months)</Label><Input id="interval" type="number" min={1} max={12} value={interval} onChange={e => setInterval(e.target.value)} /></div>
                  <p className="text-xs text-muted-foreground md:col-span-3">Split to the paisa; any remainder goes on the last installment.</p>
                </div>
              )}
              {mode === 'custom' && (
                <div className="space-y-2">
                  {custom.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-6 text-sm text-muted-foreground">{i + 1}</span>
                      <Input type="date" className="w-48" value={r.due_date} onChange={e => setRow(i, { due_date: e.target.value })} aria-label={`Installment ${i + 1} due date`} />
                      <Input className="w-40" inputMode="decimal" value={r.amount} onChange={e => setRow(i, { amount: e.target.value })} aria-label={`Installment ${i + 1} amount`}
                        placeholder={i === custom.length - 1 ? 'amount or rest' : 'amount'} />
                      <Button variant="ghost" size="icon" aria-label="Remove installment" disabled={custom.length === 1} onClick={() => setCustom(rs => rs.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setCustom(rs => [...rs, { due_date: isoIn(30 * (rs.length + 1)), amount: '' }])}><Plus className="mr-1 h-4 w-4" />Add installment</Button>
                  <p className="text-xs text-muted-foreground">Write <code>rest</code> as the last amount to put whatever is left there.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader><CardTitle>Summary</CardTitle><CardDescription>Calculated by the server, exactly as it will be posted.</CardDescription></CardHeader>
          <CardContent className="space-y-4 text-sm">
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            {quote ? (
              <>
                <dl className="grid grid-cols-2 gap-y-1">
                  <dt>Subtotal</dt><dd className="text-right"><Taka value={quote.subtotal} /></dd>
                  <dt>Discount</dt><dd className="text-right"><Taka value={quote.discount_total} /></dd>
                  <dt>Tax</dt><dd className="text-right"><Taka value={quote.tax_total} /></dd>
                  <dt className="font-semibold">Total</dt><dd className="text-right font-semibold"><Taka value={quote.grand_total} /></dd>
                  <dt>Paid now</dt><dd className="text-right"><Taka value={quote.paid_now} /></dd>
                  <dt className="font-semibold">On credit</dt><dd className="text-right font-semibold"><Taka value={quote.unpaid} /></dd>
                </dl>
                {quote.schedule.length > 0 && (
                  <Table>
                    <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                    <TableBody>{quote.schedule.map(s => (
                      <TableRow key={s.installment_no}><TableCell>{s.installment_no}</TableCell><TableCell>{s.due_date}</TableCell><TableCell className="text-right"><Taka value={s.amount} /></TableCell></TableRow>
                    ))}</TableBody>
                  </Table>
                )}
              </>
            ) : <p className="text-muted-foreground">Preview to see the totals and the schedule.</p>}
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={() => send('quote')} disabled={busy !== null}>{busy === 'quote' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Preview</Button>
              <Button onClick={() => send('post')} disabled={busy !== null || !quote}>{busy === 'post' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Post sale</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
