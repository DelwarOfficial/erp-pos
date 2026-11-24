// src/app/(erp)/dashboard/payments/page.tsx
// Payments list + create dialog.
// Consumes: GET /api/v1/payments, POST /api/v1/payments,
//           GET /api/v1/financial-accounts, GET /api/v1/branches

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/shared/PageHeader';
import { useFormat } from '@/components/i18n/I18nProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, CreditCard, Plus, RefreshCw, ArrowUpRight, ArrowDownToLine } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState, EmptyState } from '@/components/shared/StateList';
import { apiFetch } from '@/lib/api/client';
import { useDashboardSession } from '@/components/dashboard/session';
import { EntityPicker, type BusinessEntity } from '@/components/shared/EntityPicker';

interface Payment {
  id: string;
  reference_no: string;
  payment_type: string;
  direction: string;
  payment_method: string;
  payment_status: string;
  cheque_status: string | null;
  customer: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  financial_account: { id: string; name: string } | null;
  currency_code: string;
  exchange_rate: string;
  amount: string;
  base_amount: string;
  business_date: string;
  received_or_paid_at: string | null;
  reversed_payment_id: string | null;
}

interface FinancialAccount {
  id: string;
  name: string;
  account_type: string;
  is_active: boolean;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

interface CreatePaymentForm {
  branch_id: string;
  financial_account_id: string;
  payment_type: string;
  direction: string;
  payment_method: string;
  amount: string;
  method_reference: string;
  notes: string;
}

// Labels for these lists live in the catalog under payments.*
const STATUS_FILTERS = ['all', 'pending', 'posted', 'failed', 'reversed', 'cheques'];
const KNOWN_STATUSES = ['pending', 'posted', 'completed', 'failed', 'reversed'];

const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'bkash', label: 'bKash' },
  { value: 'nagad', label: 'Nagad' },
  { value: 'rocket', label: 'Rocket' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'gift_card', label: 'Gift Card' },
  { value: 'store_credit', label: 'Store Credit' },
  { value: 'other', label: 'Other' },
];

const PAYMENT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'customer_advance', label: 'Customer Advance' },
  { value: 'sale_refund', label: 'Sale Refund' },
  { value: 'purchase_payment', label: 'Purchase Payment' },
  { value: 'expense_payment', label: 'Expense Payment' },
  { value: 'other', label: 'Other' },
];

const DIRECTIONS: Array<{ value: string; label: string }> = [
  { value: 'incoming', label: 'Incoming (Receive)' },
  { value: 'outgoing', label: 'Outgoing (Pay)' },
];

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'posted':
    case 'completed':
      return 'default';
    case 'pending':
      return 'outline';
    case 'failed':
    case 'reversed':
      return 'destructive';
    default:
      return 'secondary';
  }
}

const EMPTY_FORM: CreatePaymentForm = {
  branch_id: '',
  financial_account_id: '',
  payment_type: 'customer_advance',
  direction: 'incoming',
  payment_method: 'cash',
  amount: '',
  method_reference: '',
  notes: '',
};

export default function PaymentsPage() {
  const t = useTranslations('payments');
  const f = useFormat();
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreatePaymentForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [financialAccounts, setFinancialAccounts] = useState<FinancialAccount[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const session = useDashboardSession();
  const can = (code: string) => !!(session?.is_global || session?.permissions.includes(code));
  // Money paid out must name who received it, or carry a manager's approval
  // (src/lib/approval/manualPaymentGate.ts).
  const [supplier, setSupplier] = useState<BusinessEntity | null>(null);
  const [manualApproval, setManualApproval] = useState<{ amount: string; type: string; id?: string; waiting: boolean } | null>(null);
  const [asking, setAsking] = useState(false);
  // Cheques received wait on cheque clearing until the bank clears or bounces
  // them (POST /api/v1/payments/{id}/cheque/clear | bounce).
  const [bounceTarget, setBounceTarget] = useState<Payment | null>(null);
  const [bounceReason, setBounceReason] = useState('');
  const [chequeBusy, setChequeBusy] = useState<string | null>(null);
  async function askApproval() {
    if (!manualApproval) return;
    setAsking(true);
    try {
      const res = await apiFetch('/api/v1/approvals', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `approval-${crypto.randomUUID()}` },
        body: JSON.stringify({ request_type: 'manual_payment', reference_type: 'payment', reference_id: crypto.randomUUID(), branch_id: createForm.branch_id || undefined,
          payload: { amount: manualApproval.amount, payment_type: manualApproval.type, notes: createForm.notes || undefined } }) });
      const data = await res.json();
      if (!res.ok) { toast.error(t('err_save', { reason: data?.error?.message ?? t('err_generic') })); return; }
      setManualApproval({ ...manualApproval, id: data.item.id, waiting: false });
    } catch { toast.error(t('err_network')); } finally { setAsking(false); }
  }

  const loadPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/payments?limit=100');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? t('load_failed'));
      setPayments(data.items ?? []);
    } catch (e) {
      const msg = e instanceof Error && e.message && !(e instanceof TypeError) ? e.message : t('load_failed');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadFormData = useCallback(async () => {
    try {
      const [faRes, brRes] = await Promise.all([
        apiFetch('/api/v1/financial-accounts'),
        apiFetch('/api/v1/branches'),
      ]);
      setOptionsFailed(!faRes.ok || !brRes.ok);
      if (faRes.ok) {
        const faData = await faRes.json();
        setFinancialAccounts((faData.items ?? []).filter((a: FinancialAccount) => a.is_active));
      }
      if (brRes.ok) {
        const brData = await brRes.json();
        setBranches(brData.items ?? []);
      }
    } catch {
      // Not fatal for the list, but the form cannot be filled in: say so there.
      setOptionsFailed(true);
    }
  }, []);

  useEffect(() => {
    loadPayments();
    loadFormData();
  }, [loadPayments, loadFormData]);

  async function chequeAction(p: Payment, action: 'clear' | 'bounce', reason?: string) {
    setChequeBusy(p.id);
    try {
      const res = await apiFetch(`/api/v1/payments/${p.id}/cheque/${action}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `cheque-${action}-${crypto.randomUUID()}` },
        body: JSON.stringify(action === 'bounce' ? { reason } : {}) });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error(t('cheque_err', { reason: data?.error?.message ?? t('err_generic') })); return; }
      toast.success(t(action === 'clear' ? 'cheque_cleared_toast' : 'cheque_bounced_toast', { ref: p.reference_no }));
      setBounceTarget(null);
      setBounceReason('');
      await loadPayments();
    } catch { toast.error(t('err_network')); } finally { setChequeBusy(null); }
  }

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return payments;
    if (statusFilter === 'cheques') return payments.filter(p => p.cheque_status === 'pending_clearance');
    if (statusFilter === 'completed') {
      return payments.filter(p => p.payment_status === 'posted');
    }
    return payments.filter(p => p.payment_status === statusFilter);
  }, [payments, statusFilter]);

  const totalAmount = filtered.reduce((s, p) => s + parseFloat(p.amount), 0);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(createForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(t('err_amount'));
      return;
    }
    if (!createForm.branch_id) {
      toast.error(t('err_branch'));
      return;
    }
    if (!createForm.financial_account_id) {
      toast.error(t('err_account'));
      return;
    }
    setCreating(true);
    try {
      const idempotencyKey = `payment-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await apiFetch('/api/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          branch_id: createForm.branch_id,
          financial_account_id: createForm.financial_account_id,
          payment_type: createForm.payment_type,
          direction: createForm.direction,
          payment_method: createForm.payment_method,
          amount,
          method_reference: createForm.method_reference || undefined,
          notes: createForm.notes || undefined,
          ...(createForm.direction === 'outgoing' && supplier && { supplier_id: supplier.id }),
          ...(manualApproval?.id && { approval_request_id: manualApproval.id }),
          currency_code: 'BDT',
          exchange_rate: 1,
        }),
      });
      const data = await res.json();
      const details = data?.error?.details as { request_type?: string; amount_base?: string; payment_type?: string } | undefined;
      if (!res.ok && data?.error?.code === 'APPROVAL_REQUIRED' && details?.request_type === 'manual_payment') {
        const amount = String(details.amount_base), type = String(details.payment_type);
        setManualApproval(prev => prev?.id && prev.amount === amount && prev.type === type ? { ...prev, waiting: true } : { amount, type, waiting: false });
        return;
      }
      if (!res.ok) {
        toast.error(t('err_save', { reason: data?.error?.message ?? t('err_generic') }));
        return;
      }
      toast.success(t('saved', { ref: data.reference_no ?? '', amount: f.money(data.amount) }));
      setCreateForm(EMPTY_FORM);
      setSupplier(null);
      setManualApproval(null);
      setCreateOpen(false);
      await loadPayments();
    } catch {
      toast.error(t('err_network'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={<CreditCard className="h-6 w-6" aria-hidden="true" />} title={t('title')} description={t('subtitle')}
        actions={<Button type="button" className="min-h-11" onClick={() => setCreateOpen(true)}><Plus aria-hidden="true" />{t('new')}</Button>} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('dialog_title')}</DialogTitle>
            <DialogDescription>{t('dialog_help')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4" aria-busy={creating}>
            {optionsFailed && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{t('options_failed')}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="field-app-erp-dashboard-payments-page-1" >{t('type')}</Label>
                <Select
                  value={createForm.payment_type}
                  onValueChange={v => setCreateForm({ ...createForm, payment_type: v })}
                >
                  <SelectTrigger id="field-app-erp-dashboard-payments-page-1" className="min-h-11 w-full data-[placeholder]:text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TYPES.map(item => <SelectItem key={item.value} value={item.value}>{t(`type_${item.value}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-app-erp-dashboard-payments-page-2" >{t('direction')}</Label>
                <Select
                  value={createForm.direction}
                  onValueChange={v => setCreateForm({ ...createForm, direction: v })}
                >
                  <SelectTrigger id="field-app-erp-dashboard-payments-page-2" className="min-h-11 w-full data-[placeholder]:text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIRECTIONS.map(d => <SelectItem key={d.value} value={d.value}>{t(`direction_${d.value}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-app-erp-dashboard-payments-page-3" >{t('branch')}<span aria-hidden="true" className="text-destructive"> *</span></Label>
                <Select
                  value={createForm.branch_id}
                  onValueChange={v => setCreateForm({ ...createForm, branch_id: v })}
                >
                  <SelectTrigger id="field-app-erp-dashboard-payments-page-3" className="min-h-11 w-full data-[placeholder]:text-foreground"><SelectValue placeholder={t('branch_placeholder')} /></SelectTrigger>
                  <SelectContent>
                    {branches.length === 0 ? (
                      <SelectItem value="_none" disabled>{t('branch_none')}</SelectItem>
                    ) : (
                      branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name} ({b.code})</SelectItem>)
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-app-erp-dashboard-payments-page-4" >{t('account')}<span aria-hidden="true" className="text-destructive"> *</span></Label>
                <Select
                  value={createForm.financial_account_id}
                  onValueChange={v => setCreateForm({ ...createForm, financial_account_id: v })}
                >
                  <SelectTrigger id="field-app-erp-dashboard-payments-page-4" className="min-h-11 w-full data-[placeholder]:text-foreground"><SelectValue placeholder={t('account_placeholder')} /></SelectTrigger>
                  <SelectContent>
                    {financialAccounts.length === 0 ? (
                      <SelectItem value="_none" disabled>{t('account_none')}</SelectItem>
                    ) : (
                      financialAccounts.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.name} ({a.account_type.replaceAll('_', ' ')})</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-app-erp-dashboard-payments-page-5" >{t('method')}</Label>
                <Select
                  value={createForm.payment_method}
                  onValueChange={v => setCreateForm({ ...createForm, payment_method: v })}
                >
                  <SelectTrigger id="field-app-erp-dashboard-payments-page-5" className="min-h-11 w-full data-[placeholder]:text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{t(`method_${m.value}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-app-erp-dashboard-payments-page-6" >{t('amount')}<span aria-hidden="true" className="text-destructive"> *</span></Label>
                <Input id="field-app-erp-dashboard-payments-page-6"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  aria-required="true"
                  value={createForm.amount}
                  onChange={e => setCreateForm({ ...createForm, amount: e.target.value })}
                  required
                  className="min-h-[40px]"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="field-app-erp-dashboard-payments-page-7" >{t('reference')}</Label>
                <Input id="field-app-erp-dashboard-payments-page-7"
                  placeholder={t('reference_placeholder')}
                  value={createForm.method_reference}
                  onChange={e => setCreateForm({ ...createForm, method_reference: e.target.value })}
                  maxLength={120}
                  className="min-h-[40px]"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="field-app-erp-dashboard-payments-page-8" >{t('notes')}</Label>
                <Input id="field-app-erp-dashboard-payments-page-8"
                  placeholder={t('notes_placeholder')}
                  value={createForm.notes}
                  onChange={e => setCreateForm({ ...createForm, notes: e.target.value })}
                  maxLength={500}
                  className="min-h-[40px]"
                />
              </div>
              {createForm.direction === 'outgoing' && createForm.payment_type !== 'sale_refund' ? <div className="space-y-1.5 sm:col-span-2">
                <EntityPicker label={t('supplier_label')} endpoint="/api/v1/suppliers" value={supplier} onChange={value => { setSupplier(value); setManualApproval(null); }} disabled={creating} />
                <p className="text-xs text-muted-foreground">{t('supplier_help')}</p>
              </div> : null}
            </div>
            {manualApproval ? <div role="status" aria-live="polite" className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium">{t('approval_needed', { amount: f.money(manualApproval.amount) })}</p>
              {manualApproval.id ? <p>{t(manualApproval.waiting ? 'approval_waiting' : 'approval_requested')}</p>
                : can('approval.request') && can('approval.read') ? <Button type="button" variant="outline" className="min-h-11" disabled={asking || creating} onClick={() => void askApproval()}>{t('approval_ask')}</Button>
                : <p>{t('approval_ask_manager')}</p>}
            </div> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={creating} className="min-h-11">
                {creating ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                {creating ? t('saving') : t('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base"><h2>{t('list_title', { count: filtered.length })}</h2></CardTitle>
            <CardDescription className="tabular-nums">{t('list_total', { amount: f.money(totalAmount) })}</CardDescription>
          </div>
          {!loading && !error && (
            <Button type="button" size="sm" variant="ghost" onClick={loadPayments} className="min-h-10">
              <RefreshCw aria-hidden="true" /> {t('refresh')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('filter_label')}>
            {STATUS_FILTERS.map(status => (
              <Button
                key={status}
                type="button"
                size="sm"
                variant={statusFilter === status ? 'default' : 'outline'}
                aria-pressed={statusFilter === status}
                onClick={() => setStatusFilter(status)}
                className="min-h-10"
              >
                {status === 'all' ? t('filter_all') : status === 'cheques' ? t('filter_cheques') : t(`status.${status}`)}
              </Button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2" role="status" aria-label={t('loading')}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24 ml-auto" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          ) : error ? (
            <ErrorState message={error} onRetry={loadPayments} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<CreditCard className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />}
              message={statusFilter === 'all' ? t('empty') : t('empty_filtered')}
              action={statusFilter === 'all' ? <Button type="button" onClick={() => setCreateOpen(true)}><Plus aria-hidden="true" />{t('new')}</Button> : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('col_date')}</TableHead>
                    <TableHead>{t('col_reference')}</TableHead>
                    <TableHead>{t('col_method')}</TableHead>
                    <TableHead>{t('col_party')}</TableHead>
                    <TableHead className="text-right">{t('col_amount')}</TableHead>
                    <TableHead>{t('col_status')}</TableHead>
                    <TableHead className="text-right"><span className="sr-only">{t('col_actions')}</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(p => {
                    const dateStr = p.received_or_paid_at ?? p.business_date;
                    const counterparty = p.customer?.name ?? p.supplier?.name ?? '—';
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {f.date(dateStr)}
                        </TableCell>
                        <TableCell className="font-medium whitespace-nowrap">
                          {p.reference_no}
                          {p.reversed_payment_id && (
                            <Badge variant="outline" className="ml-1.5 text-xs">{t('reversal_tag')}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            {p.direction === 'outgoing'
                              ? <ArrowUpRight className="size-4 text-destructive" aria-hidden="true" />
                              : <ArrowDownToLine className="size-4 text-success-foreground" aria-hidden="true" />}
                            {PAYMENT_METHODS.some(m => m.value === p.payment_method) ? t(`method_${p.payment_method}`) : p.payment_method}
                            <span className="text-xs text-muted-foreground">· {p.direction === 'outgoing' ? t('out') : t('in')}</span>
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm" title={counterparty}>
                          {counterparty}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {f.money(p.amount, p.currency_code)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(p.payment_status)}>{KNOWN_STATUSES.includes(p.payment_status) ? t(`status.${p.payment_status}`) : p.payment_status}</Badge>
                          {p.cheque_status && ['pending_clearance', 'cleared', 'bounced'].includes(p.cheque_status) && (
                            <Badge variant={p.cheque_status === 'bounced' ? 'destructive' : 'outline'} className="ml-1.5 text-xs">{t(`cheque_${p.cheque_status}`)}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap space-x-1.5">
                          {p.cheque_status === 'pending_clearance' && p.direction === 'incoming' && p.payment_status === 'posted' && (
                            <>
                              {can('cheque.clear') && (
                                <Button type="button" size="sm" variant="outline" disabled={chequeBusy === p.id} onClick={() => chequeAction(p, 'clear')}
                                  aria-label={t('cheque_clear_named', { ref: p.reference_no })}>
                                  {chequeBusy === p.id && <Loader2 className="animate-spin" aria-hidden="true" />}{t('cheque_clear')}
                                </Button>
                              )}
                              {can('cheque.bounce') && (
                                <Button type="button" size="sm" variant="outline" disabled={chequeBusy === p.id} onClick={() => { setBounceReason(''); setBounceTarget(p); }}
                                  aria-label={t('cheque_bounce_named', { ref: p.reference_no })}>
                                  {t('cheque_bounce')}
                                </Button>
                              )}
                            </>
                          )}
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/dashboard/payments/${p.id}`} aria-label={t('view_named', { ref: p.reference_no })}>{t('view')}</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!bounceTarget} onOpenChange={open => { if (!open) setBounceTarget(null); }}>
        <DialogContent>
          <form onSubmit={e => { e.preventDefault(); if (bounceTarget && bounceReason.trim()) chequeAction(bounceTarget, 'bounce', bounceReason.trim()); }}>
            <DialogHeader>
              <DialogTitle>{t('cheque_bounce_title', { ref: bounceTarget?.reference_no ?? '' })}</DialogTitle>
              <DialogDescription>{t('cheque_bounce_desc', { amount: bounceTarget ? f.money(bounceTarget.amount, bounceTarget.currency_code) : '' })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="cheque-bounce-reason">{t('cheque_bounce_reason')}</Label>
              <Input id="cheque-bounce-reason" value={bounceReason} onChange={e => setBounceReason(e.target.value)} required maxLength={500} autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBounceTarget(null)}>{t('cancel')}</Button>
              <Button type="submit" variant="destructive" disabled={!bounceReason.trim() || chequeBusy === bounceTarget?.id}>
                {chequeBusy === bounceTarget?.id && <Loader2 className="animate-spin" aria-hidden="true" />}{t('cheque_bounce_confirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
