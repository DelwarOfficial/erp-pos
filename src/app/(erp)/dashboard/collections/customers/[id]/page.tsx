// src/app/(erp)/dashboard/collections/customers/[id]/page.tsx
// A customer's dues: summary, installments, collect a payment, and the history.
// Consumes: GET /api/v1/customers/{id}/receivable, GET /api/v1/customers/{id}/collection-timeline,
//           POST /api/v1/customers/{id}/collections, GET /api/v1/branches, GET /api/v1/financial-accounts.
// The server applies a payment oldest due first and says where it went; nothing is computed here.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, HandCoins, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, EmptyState } from '@/components/shared/StateList';
import { apiFetch } from '@/lib/api/client';
import { InstallmentStatusBadge, newIdempotencyKey, readError, SmsStatusBadge, Taka, useCan } from '@/components/collections/common';
import { ReminderDialog } from '@/components/collections/ReminderDialog';
import { FollowUpsCard, PromisesCard, RescheduleDialog, type OpenInstallment } from '@/components/collections/FollowThrough';

interface Receivable {
  customer: { id: string; name: string }; as_of: string; outstanding: string; overdue: string;
  next_due: { due_date: string; amount: string } | null;
  installments: Array<{ installment_id: string; sale_id: string; sale_reference_no: string; installment_no: number; due_date: string;
    amount: string; collected: string; outstanding: string; status: string; reminders_enabled: boolean }>;
}
interface TimelineEvent { at: string; kind: string; title: string; amount?: string; reference?: string; status?: string; detail?: string }
interface Option { id: string; name: string }
interface Applied { sale_reference_no: string; installment_no: number; amount: string; remaining: string }

const METHODS = [['cash', 'Cash'], ['bkash', 'bKash'], ['nagad', 'Nagad'], ['rocket', 'Rocket'], ['card', 'Card'], ['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['other', 'Other']] as const;
const AMOUNT = /^\d{1,15}(\.\d{1,2})?$/;

export default function CustomerCollectionPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const [data, setData] = useState<Receivable | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remindFor, setRemindFor] = useState<string | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<OpenInstallment | null>(null);

  const [branches, setBranches] = useState<Option[]>([]);
  const [accounts, setAccounts] = useState<Option[]>([]);
  const [branchId, setBranchId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [chosenSales, setChosenSales] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [applied, setApplied] = useState<Applied[] | null>(null);
  const [collectKey, setCollectKey] = useState(() => newIdempotencyKey('collection'));

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, t] = await Promise.all([apiFetch(`/api/v1/customers/${id}/receivable`), apiFetch(`/api/v1/customers/${id}/collection-timeline`)]);
      if (!r.ok) throw new Error(await readError(r));
      setData(await r.json());
      setTimeline(t.ok ? (await t.json()).items : []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load this customer'); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!can('payment.pay.branch')) return;
    void Promise.all([apiFetch('/api/v1/branches'), apiFetch('/api/v1/financial-accounts')]).then(async ([b, f]) => {
      const bs = b.ok ? (await b.json()).items as Option[] : [];
      const fs = f.ok ? ((await f.json()).items as Array<Option & { is_active?: boolean }>).filter(a => a.is_active !== false) : [];
      setBranches(bs); setAccounts(fs);
      if (bs.length === 1) setBranchId(bs[0].id);
    });
  }, []);

  const openSales = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of data?.installments ?? []) if (i.outstanding !== '0.00') seen.set(i.sale_id, i.sale_reference_no);
    return [...seen].map(([saleId, ref]) => ({ saleId, ref }));
  }, [data]);

  async function collect(e: React.FormEvent) {
    e.preventDefault();
    if (!AMOUNT.test(amount) || amount === '0' || /^0+(\.0+)?$/.test(amount)) { toast.error('Enter an amount like 1500 or 1500.50'); return; }
    if (!branchId || !accountId) { toast.error('Choose the branch and the account the money goes into'); return; }
    setSaving(true);
    try {
      const r = await apiFetch(`/api/v1/customers/${id}/collections`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': collectKey },
        body: JSON.stringify({ branch_id: branchId, financial_account_id: accountId, amount, payment_method: method,
          method_reference: reference || undefined, sale_ids: chosenSales.length ? chosenSales : undefined }),
      });
      if (!r.ok) throw new Error(await readError(r));
      const result = await r.json();
      setApplied(result.applied);
      toast.success(`Payment ${result.reference_no} recorded. Still owed: ৳${result.customer_outstanding}`);
      setAmount(''); setReference(''); setChosenSales([]);
      setCollectKey(newIdempotencyKey('collection'));
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record the payment');
    } finally { setSaving(false); }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <div className="space-y-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild><Link href="/dashboard/collections"><ArrowLeft className="mr-1 h-4 w-4" />Collections</Link></Button>
        <h1 className="text-2xl font-semibold tracking-tight">{data.customer.name}</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardDescription>Owed now</CardDescription><CardTitle className="text-2xl"><Taka value={data.outstanding} /></CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Overdue</CardDescription><CardTitle className={`text-2xl ${data.overdue !== '0.00' ? 'text-destructive' : ''}`}><Taka value={data.overdue} /></CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Next due</CardDescription>
          <CardTitle className="text-2xl">{data.next_due ? <><Taka value={data.next_due.amount} /> <span className="text-sm font-normal text-muted-foreground">on {data.next_due.due_date}</span></> : '—'}</CardTitle>
        </CardHeader></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Installments</CardTitle><CardDescription>As of {data.as_of}. Paid amounts count payments still posted; a reversed payment reopens its installment.</CardDescription></CardHeader>
        <CardContent>
          {data.installments.length === 0 ? <EmptyState message="This customer has no scheduled dues." /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Invoice</TableHead><TableHead>Due date</TableHead><TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Owed</TableHead><TableHead>Status</TableHead><TableHead />
                </TableRow></TableHeader>
                <TableBody>
                  {data.installments.map(i => (
                    <TableRow key={i.installment_id}>
                      <TableCell className="whitespace-nowrap">{i.sale_reference_no} <span className="text-muted-foreground">#{i.installment_no}</span></TableCell>
                      <TableCell>{i.due_date}</TableCell>
                      <TableCell className="text-right"><Taka value={i.amount} /></TableCell>
                      <TableCell className="text-right"><Taka value={i.collected} /></TableCell>
                      <TableCell className="text-right font-medium"><Taka value={i.outstanding} /></TableCell>
                      <TableCell><InstallmentStatusBadge status={i.status} />{!i.reminders_enabled && <Badge variant="outline" className="ml-2">Reminders off</Badge>}</TableCell>
                      <TableCell className="text-right">
                        {i.status !== 'paid' && (
                          <span className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => setRemindFor(i.installment_id)}><Send className="mr-1 h-3.5 w-3.5" />Remind</Button>
                            {can('collection.reschedule.branch') && <Button size="sm" variant="ghost" onClick={() => setRescheduleFor(i)}>Change date</Button>}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {can('payment.pay.branch') && data.outstanding !== '0.00' && (
        <Card id="collect">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><HandCoins className="h-5 w-5" />Collect a payment</CardTitle>
            <CardDescription>Applied to the oldest due installment first, or only to the invoices you tick. More than is owed is refused — record it as an advance instead.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={collect}>
              <div className="space-y-1">
                <Label htmlFor="collect-amount">Amount (৳)</Label>
                <Input id="collect-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.trim())} placeholder={data.outstanding} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="collect-method">Method</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger id="collect-method"><SelectValue /></SelectTrigger>
                  <SelectContent>{METHODS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="collect-branch">Branch</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger id="collect-branch"><SelectValue placeholder="Choose the branch" /></SelectTrigger>
                  <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="collect-account">Into account</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger id="collect-account"><SelectValue placeholder="Cash box, bank or wallet" /></SelectTrigger>
                  <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="collect-reference">Reference (optional)</Label>
                <Input id="collect-reference" value={reference} onChange={e => setReference(e.target.value)} placeholder="Transaction ID, cheque number…" maxLength={120} />
              </div>
              {openSales.length > 1 && (
                <fieldset className="space-y-2 md:col-span-2">
                  <legend className="text-sm font-medium">Apply only to these invoices (optional)</legend>
                  <div className="flex flex-wrap gap-4">
                    {openSales.map(s => (
                      <label key={s.saleId} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={chosenSales.includes(s.saleId)} onCheckedChange={c => setChosenSales(prev => c ? [...prev, s.saleId] : prev.filter(x => x !== s.saleId))} />
                        {s.ref}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <div className="md:col-span-2">
                <Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record payment</Button>
              </div>
            </form>
            {applied && (
              <div className="mt-4 rounded-md border p-3 text-sm">
                <p className="mb-2 font-medium">Where the last payment went</p>
                <ul className="space-y-1">
                  {applied.map((a, i) => <li key={i}>{a.sale_reference_no} #{a.installment_no}: <Taka value={a.amount} /> — still owed <Taka value={a.remaining} /></li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <PromisesCard customerId={data.customer.id} installments={data.installments} onChange={load} />
        <FollowUpsCard customerId={data.customer.id} installments={data.installments} onChange={load} />
      </div>

      <Card>
        <CardHeader><CardTitle>History</CardTitle><CardDescription>Credit sales, payments, promises, follow-ups, due-date changes and reminders, newest first.</CardDescription></CardHeader>
        <CardContent>
          {!timeline ? <Skeleton className="h-24" /> : timeline.length === 0 ? <EmptyState message="Nothing yet." /> : (
            <ol className="space-y-3">
              {timeline.map((e, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 pl-3">
                  <span className="w-36 shrink-0 text-xs text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
                  <span className="font-medium">{e.title}</span>
                  {e.amount && <Taka value={e.amount} />}
                  {e.kind === 'sms' && e.status ? <SmsStatusBadge status={e.status} /> : e.status && e.status !== 'posted' && e.status !== 'completed' ? <Badge variant="outline">{e.status}</Badge> : null}
                  {e.detail && <span className="w-full text-xs text-muted-foreground">{e.detail}</span>}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <RescheduleDialog installment={rescheduleFor} onClose={() => setRescheduleFor(null)} onDone={load} />
      <ReminderDialog installmentId={remindFor} open={remindFor !== null} onOpenChange={open => { if (!open) setRemindFor(null); }} onSent={load} />
    </div>
  );
}
