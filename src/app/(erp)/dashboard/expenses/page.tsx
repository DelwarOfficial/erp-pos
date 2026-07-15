// src/app/(erp)/dashboard/expenses/page.tsx
// Expense management — list, create, approve.
// Consumes: GET /api/v1/expenses, POST /api/v1/expenses, POST /api/v1/expenses/[id]/approve

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Loader2, Wallet, Plus, CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';

interface Expense {
  id: string;
  referenceNo: string;
  status: string;
  expenseDate: string;
  grandTotal: string;
  description: string;
  createdAt: string;
}

interface ExpenseItem {
  expense_category_id: string;
  description?: string;
  amount: number;
  tax_amount: number;
}

interface CreateExpenseForm {
  branch_id: string;
  expense_date: string;
  description: string;
  payee_name: string;
  financial_account_id: string;
  items: ExpenseItem[];
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'posted', label: 'Posted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'voided', label: 'Voided' },
];

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'posted': return 'default';
    case 'approved': return 'secondary';
    case 'pending_approval': return 'outline';
    case 'rejected':
    case 'voided': return 'destructive';
    default: return 'outline';
  }
}

const EMPTY_FORM: CreateExpenseForm = {
  branch_id: '',
  expense_date: new Date().toISOString().slice(0, 10),
  description: '',
  payee_name: '',
  financial_account_id: '',
  items: [{ expense_category_id: '', description: '', amount: 0, tax_amount: 0 }],
};

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateExpenseForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/expenses?limit=100');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load expenses');
      setExpenses(data.items ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadExpenses(); }, [loadExpenses]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return expenses;
    return expenses.filter(e => e.status === statusFilter);
  }, [expenses, statusFilter]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (createForm.items.length === 0) {
      toast.error('Add at least one line item');
      return;
    }
    setCreating(true);
    try {
      const idempotencyKey = `expense-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await fetch('/api/v1/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          branch_id: createForm.branch_id,
          expense_date: createForm.expense_date,
          currency_code: 'BDT',
          exchange_rate: 1.0,
          description: createForm.description,
          payee_name: createForm.payee_name || undefined,
          financial_account_id: createForm.financial_account_id,
          items: createForm.items.map(i => ({
            expense_category_id: i.expense_category_id,
            description: i.description || undefined,
            amount: Number(i.amount),
            tax_amount: Number(i.tax_amount ?? 0),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Failed to create expense');
        return;
      }
      toast.success(`Expense ${data.reference_no ?? 'created'} - ${data.status}`);
      setCreateForm(EMPTY_FORM);
      setCreateOpen(false);
      await loadExpenses();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setCreating(false);
    }
  }

  async function handleApprove(expenseId: string) {
    setApprovingId(expenseId);
    try {
      const idempotencyKey = `expense-approve-${expenseId}-${Date.now()}`;
      const res = await fetch(`/api/v1/expenses/${expenseId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ decision: 'approved' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error?.message ?? `Approval failed (HTTP ${res.status})`);
        return;
      }
      toast.success('Expense approved');
      await loadExpenses();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setApprovingId(null);
    }
  }

  function updateItem(idx: number, patch: Partial<ExpenseItem>) {
    setCreateForm(prev => ({
      ...prev,
      items: prev.items.map((it, i) => i === idx ? { ...it, ...patch } : it),
    }));
  }
  function addItem() {
    setCreateForm(prev => ({ ...prev, items: [...prev.items, { expense_category_id: '', description: '', amount: 0, tax_amount: 0 }] }));
  }
  function removeItem(idx: number) {
    setCreateForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="h-6 w-6" /> Expenses
          </h1>
          <p className="text-muted-foreground">
            Post operational expenses with GL integration. Approve pending expenses before posting.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="min-h-[44px]">
              <Plus className="h-4 w-4 mr-2" /> New Expense
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Expense</DialogTitle>
              <DialogDescription>
                Submit a new expense. Status starts as pending_approval when the category requires approval.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Branch ID</Label>
                  <Input
                    placeholder="UUID"
                    value={createForm.branch_id}
                    onChange={e => setCreateForm({ ...createForm, branch_id: e.target.value })}
                    required
                    className="min-h-[40px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Financial Account ID</Label>
                  <Input
                    placeholder="UUID"
                    value={createForm.financial_account_id}
                    onChange={e => setCreateForm({ ...createForm, financial_account_id: e.target.value })}
                    required
                    className="min-h-[40px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Expense Date</Label>
                  <Input
                    type="date"
                    value={createForm.expense_date}
                    onChange={e => setCreateForm({ ...createForm, expense_date: e.target.value })}
                    required
                    className="min-h-[40px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Payee Name (optional)</Label>
                  <Input
                    placeholder="Payee"
                    value={createForm.payee_name}
                    onChange={e => setCreateForm({ ...createForm, payee_name: e.target.value })}
                    className="min-h-[40px]"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description</Label>
                <Textarea
                  placeholder="Expense description"
                  value={createForm.description}
                  onChange={e => setCreateForm({ ...createForm, description: e.target.value })}
                  required
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Line Items</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addItem} className="min-h-[36px]">
                    <Plus className="h-3 w-3 mr-1" /> Add Line
                  </Button>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {createForm.items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 border rounded p-2">
                      <Input
                        placeholder="Category ID (UUID)"
                        value={item.expense_category_id}
                        onChange={e => updateItem(idx, { expense_category_id: e.target.value })}
                        required
                        className="sm:col-span-5 min-h-[40px]"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Amount"
                        value={item.amount || ''}
                        onChange={e => updateItem(idx, { amount: Number(e.target.value) })}
                        required
                        className="sm:col-span-3 min-h-[40px]"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Tax"
                        value={item.tax_amount || ''}
                        onChange={e => updateItem(idx, { tax_amount: Number(e.target.value) })}
                        className="sm:col-span-3 min-h-[40px]"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeItem(idx)}
                        disabled={createForm.items.length === 1}
                        className="sm:col-span-1 min-h-[40px]"
                        aria-label="Remove line"
                      >
                        x
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                  Cancel
                </Button>
                <Button type="submit" disabled={creating} className="min-h-[44px]">
                  {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Submit Expense
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base">Expenses ({filtered.length})</CardTitle>
            <CardDescription>Filter by status. Approve pending expenses to post them to the GL.</CardDescription>
          </div>
          {!loading && !error && (
            <Button size="sm" variant="ghost" onClick={loadExpenses} className="min-h-[40px]">
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
            <LoadingState label="Loading expenses..." />
          ) : error ? (
            <ErrorState message={error} onRetry={loadExpenses} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Wallet className="h-8 w-8 text-muted-foreground/50" />}
              message="No expenses match the selected filter."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Evidence</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(exp => (
                    <TableRow key={exp.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(exp.expenseDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{exp.referenceNo}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-sm" title={exp.description}>
                        {exp.description}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        BDT {Number(exp.grandTotal).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(exp.status)}>{exp.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <a
                          href={`/api/v1/expenses/${exp.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        >
                          View <ExternalLink className="h-3 w-3" />
                        </a>
                      </TableCell>
                      <TableCell className="text-right">
                        {exp.status === 'pending_approval' || exp.status === 'draft' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleApprove(exp.id)}
                            disabled={approvingId === exp.id}
                            className="min-h-[36px]"
                          >
                            {approvingId === exp.id
                              ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              : <CheckCircle2 className="h-3 w-3 mr-1" />}
                            Approve
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">--</span>
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
    </div>
  );
}
