// src/app/(erp)/dashboard/payments/page.tsx
// Payments list + create dialog.
// Consumes: GET /api/v1/payments, POST /api/v1/payments,
//           GET /api/v1/financial-accounts, GET /api/v1/branches

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
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

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'posted', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'reversed', label: 'Reversed' },
];

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
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreatePaymentForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [financialAccounts, setFinancialAccounts] = useState<FinancialAccount[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  const loadPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/payments?limit=100');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load payments');
      setPayments(data.items ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFormData = useCallback(async () => {
    try {
      const [faRes, brRes] = await Promise.all([
        fetch('/api/v1/financial-accounts'),
        fetch('/api/v1/branches'),
      ]);
      if (faRes.ok) {
        const faData = await faRes.json();
        setFinancialAccounts((faData.items ?? []).filter((a: FinancialAccount) => a.is_active));
      }
      if (brRes.ok) {
        const brData = await brRes.json();
        setBranches(brData.items ?? []);
      }
    } catch (e) {
      // Non-fatal — form will still let user paste UUIDs
      console.warn('Failed to load form options', e);
    }
  }, []);

  useEffect(() => {
    loadPayments();
    loadFormData();
  }, [loadPayments, loadFormData]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return payments;
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
      toast.error('Amount must be a positive number');
      return;
    }
    if (!createForm.branch_id) {
      toast.error('Branch is required');
      return;
    }
    if (!createForm.financial_account_id) {
      toast.error('Financial account is required');
      return;
    }
    setCreating(true);
    try {
      const idempotencyKey = `payment-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await fetch('/api/v1/payments', {
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
          currency_code: 'BDT',
          exchange_rate: 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Failed to create payment');
        return;
      }
      toast.success(`Payment ${data.reference_no ?? 'created'} - ৳ ${Number(data.amount).toFixed(2)}`);
      setCreateForm(EMPTY_FORM);
      setCreateOpen(false);
      await loadPayments();
    } catch (e) {
      toast.error('Failed to create payment: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="h-6 w-6" /> Payments
          </h1>
          <p className="text-muted-foreground">
            Record standalone payments, advances and refunds. Posted payments hit the GL automatically.
          </p>
        </div>
        <Button className="min-h-[44px]" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> New Payment
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Payment</DialogTitle>
            <DialogDescription>
              Record a standalone payment. Sale-receipt payments are created automatically from the POS.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Payment Type</Label>
                <Select
                  value={createForm.payment_type}
                  onValueChange={v => setCreateForm({ ...createForm, payment_type: v })}
                >
                  <SelectTrigger className="min-h-[40px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Direction</Label>
                <Select
                  value={createForm.direction}
                  onValueChange={v => setCreateForm({ ...createForm, direction: v })}
                >
                  <SelectTrigger className="min-h-[40px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIRECTIONS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Branch</Label>
                <Select
                  value={createForm.branch_id}
                  onValueChange={v => setCreateForm({ ...createForm, branch_id: v })}
                >
                  <SelectTrigger className="min-h-[40px]"><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    {branches.length === 0 ? (
                      <SelectItem value="_none" disabled>No branches available</SelectItem>
                    ) : (
                      branches.map(b => <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>)
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Financial Account</Label>
                <Select
                  value={createForm.financial_account_id}
                  onValueChange={v => setCreateForm({ ...createForm, financial_account_id: v })}
                >
                  <SelectTrigger className="min-h-[40px]"><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {financialAccounts.length === 0 ? (
                      <SelectItem value="_none" disabled>No accounts available</SelectItem>
                    ) : (
                      financialAccounts.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.name} ({a.account_type})</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Payment Method</Label>
                <Select
                  value={createForm.payment_method}
                  onValueChange={v => setCreateForm({ ...createForm, payment_method: v })}
                >
                  <SelectTrigger className="min-h-[40px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Amount (BDT) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={createForm.amount}
                  onChange={e => setCreateForm({ ...createForm, amount: e.target.value })}
                  required
                  className="min-h-[40px]"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Method Reference (optional)</Label>
                <Input
                  placeholder="Txn ID, cheque no., gateway ref..."
                  value={createForm.method_reference}
                  onChange={e => setCreateForm({ ...createForm, method_reference: e.target.value })}
                  maxLength={120}
                  className="min-h-[40px]"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Notes (optional)</Label>
                <Input
                  placeholder="Notes"
                  value={createForm.notes}
                  onChange={e => setCreateForm({ ...createForm, notes: e.target.value })}
                  maxLength={500}
                  className="min-h-[40px]"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating} className="min-h-[44px]">
                {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Record Payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base">Payments ({filtered.length})</CardTitle>
            <CardDescription>
              Filter by status. Total shown reflects current filter: ৳ {totalAmount.toLocaleString('en-BD', { maximumFractionDigits: 2 })}
            </CardDescription>
          </div>
          {!loading && !error && (
            <Button size="sm" variant="ghost" onClick={loadPayments} className="min-h-[40px]">
              <RefreshCw className="h-3 w-3 mr-1" /> Refresh
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map(f => (
              <Button
                key={f.value}
                size="sm"
                variant={statusFilter === f.value ? 'default' : 'outline'}
                onClick={() => setStatusFilter(f.value)}
                className="min-h-[36px]"
              >
                {f.label}
              </Button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2">
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
              icon={<CreditCard className="h-8 w-8 text-muted-foreground/50" />}
              message="No payments match the selected filter."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Counterparty</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(p => {
                    const dateStr = p.received_or_paid_at ?? p.business_date;
                    const counterparty = p.customer?.name ?? p.supplier?.name ?? '—';
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {dateStr ? new Date(dateStr).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {p.reference_no}
                          {p.reversed_payment_id && (
                            <span className="ml-1 text-destructive">(rev)</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {p.payment_method}
                          </Badge>
                          {p.direction === 'outgoing' ? (
                            <ArrowUpRight className="inline-block ml-1 h-3 w-3 text-destructive" aria-label="Outgoing" />
                          ) : (
                            <ArrowDownToLine className="inline-block ml-1 h-3 w-3 text-emerald-600" aria-label="Incoming" />
                          )}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm" title={counterparty}>
                          {counterparty}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          ৳ {Number(p.amount).toFixed(2)}
                          {p.currency_code !== 'BDT' && (
                            <span className="ml-1 text-muted-foreground">{p.currency_code}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(p.payment_status)}>{p.payment_status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <a
                            href={`/api/v1/payments/${p.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline"
                          >
                            View
                          </a>
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
    </div>
  );
}
