// src/app/(erp)/dashboard/bank-reconciliation/page.tsx
// Bank reconciliation list + create form + drill-down view with auto/manual match.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Landmark, Plus, RefreshCw, CheckCircle2, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';

interface Reconciliation {
  id: string;
  status: string;
  statement_date: string;
  financial_account: { id: string; name: string; account_type: string };
  statement_opening_balance: string;
  statement_closing_balance: string;
  system_opening_balance: string;
  system_closing_balance: string;
  matched_transactions: number;
  unmatched_system: number;
  unmatched_statement: number;
  variance: string;
  reconciled_at: string | null;
  created_at: string;
}

interface FinancialAccount {
  id: string;
  name: string;
  account_type: string;
}

interface ReconciliationLine {
  id: string;
  line_type: string;
  transaction_date: string;
  description: string;
  amount: string;
  reference_no: string | null;
  match_status: string;
  match_method: string | null;
  matched_line_id: string | null;
}

interface ReconciliationDetail extends Reconciliation {
  lines: ReconciliationLine[];
}

const STATUS_COLOR: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline',
  in_progress: 'default',
  reconciled: 'secondary',
  has_variance: 'destructive',
};

export default function BankReconciliationPage() {
  const [items, setItems] = useState<Reconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReconciliationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [financialAccounts, setFinancialAccounts] = useState<FinancialAccount[]>([]);
  const [faId, setFaId] = useState('');
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10));
  const [stmtOpening, setStmtOpening] = useState('0');
  const [stmtClosing, setStmtClosing] = useState('0');
  const [posting, setPosting] = useState(false);

  // Manual-match selection state
  const [systemLineSelected, setSystemLineSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/bank-reconciliations?limit=100');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load reconciliations');
      setItems(data.items ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFinancialAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/financial-accounts');
      const data = await res.json();
      if (res.ok) {
        setFinancialAccounts(data.items ?? []);
        if (data.items?.length > 0 && !faId) setFaId(data.items[0].id);
      }
    } catch (e) { console.warn('FA load failed', e); }
  }, [faId]);

  useEffect(() => { load(); loadFinancialAccounts(); }, [load, loadFinancialAccounts]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setSelectedId(id);
    try {
      const res = await fetch(`/api/v1/bank-reconciliations/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load detail');
      setDetail(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
      setDetail(null);
    } finally { setDetailLoading(false); }
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!faId) { toast.error('Select a financial account'); return; }
    setPosting(true);
    try {
      const idempotencyKey = `br-${Date.now()}`;
      const res = await fetch('/api/v1/bank-reconciliations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          financial_account_id: faId,
          statement_date: statementDate,
          statement_opening_balance: Number(stmtOpening),
          statement_closing_balance: Number(stmtClosing),
          statement_lines: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success(`Reconciliation created — ${data.system_lines_imported} system lines imported`);
      setShowForm(false);
      await load();
      await loadDetail(data.id);
    } finally { setPosting(false); }
  }

  async function handleAutoMatch() {
    if (!selectedId) return;
    try {
      const idempotencyKey = `am-${selectedId}-${Date.now()}`;
      const res = await fetch(`/api/v1/bank-reconciliations/${selectedId}/auto-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success(`Auto-matched ${data.matched} transactions`);
      await loadDetail(selectedId);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  }

  async function handleManualMatch(statementLineId: string) {
    if (!selectedId || !systemLineSelected) {
      toast.error('Select a system line first');
      return;
    }
    try {
      const idempotencyKey = `mm-${selectedId}-${systemLineSelected}-${statementLineId}`;
      const res = await fetch(`/api/v1/bank-reconciliations/${selectedId}/manual-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          system_line_id: systemLineSelected,
          statement_line_id: statementLineId,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success('Lines matched');
      setSystemLineSelected(null);
      await loadDetail(selectedId);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  }

  async function handleFinalize() {
    if (!selectedId) return;
    if (!window.confirm('Finalize this reconciliation? A variance journal entry will be posted if system ≠ statement closing balance.')) return;
    try {
      const idempotencyKey = `fn-${selectedId}-${Date.now()}`;
      const res = await fetch(`/api/v1/bank-reconciliations/${selectedId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success(`Finalized — status: ${data.status}, variance ৳ ${data.variance}${data.journal_entry_no ? `, JE: ${data.journal_entry_no}` : ''}`);
      await loadDetail(selectedId);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  }

  const systemLines = detail?.lines.filter(l => l.line_type === 'system') ?? [];
  const statementLines = detail?.lines.filter(l => l.line_type === 'statement') ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Landmark className="h-6 w-6" /> Bank Reconciliation</h1>
          <p className="text-muted-foreground">Match system payments against the bank statement and post variance adjustments.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="min-h-[44px]" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button className="min-h-[44px]" onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4 mr-2" /> New Reconciliation
          </Button>
        </div>
      </div>

      {showForm && (
        <Card>
          <form onSubmit={handleCreate}>
            <CardHeader>
              <CardTitle className="text-base">New Bank Reconciliation</CardTitle>
              <CardDescription>System lines from the last 30 days of payments are auto-imported.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Financial Account</Label>
                  <Select value={faId} onValueChange={setFaId}>
                    <SelectTrigger><SelectValue placeholder="Select financial account" /></SelectTrigger>
                    <SelectContent>
                      {financialAccounts.map(f => <SelectItem key={f.id} value={f.id}>{f.name} ({f.account_type})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="stmt_date">Statement Date</Label>
                  <Input id="stmt_date" type="date" value={statementDate} onChange={e => setStatementDate(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="stmt_opening">Statement Opening Balance</Label>
                  <Input id="stmt_opening" type="number" step="0.01" value={stmtOpening} onChange={e => setStmtOpening(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="stmt_closing">Statement Closing Balance</Label>
                  <Input id="stmt_closing" type="number" step="0.01" value={stmtClosing} onChange={e => setStmtClosing(e.target.value)} required />
                </div>
              </div>
            </CardContent>
            <CardFooter className="gap-2">
              <Button type="submit" disabled={posting} className="min-h-[44px]">
                {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Create
              </Button>
              <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setShowForm(false)}>Cancel</Button>
            </CardFooter>
          </form>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Reconciliations ({items.length})</CardTitle>
            <CardDescription>Click a row to view lines and run matching.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingState label="Loading reconciliations…" />
            ) : error ? (
              <ErrorState message={error} onRetry={load} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<Landmark className="h-8 w-8 text-muted-foreground/50" />}
                message={<>No reconciliations yet. Click <strong>New Reconciliation</strong> to start.</>}
              />
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {items.map(r => (
                  <button
                    key={r.id}
                    onClick={() => loadDetail(r.id)}
                    className={`w-full text-left border rounded p-3 hover:bg-slate-50 transition-colors ${selectedId === r.id ? 'border-primary bg-slate-50' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.financial_account.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(r.statement_date).toLocaleDateString()} · matched: {r.matched_transactions} / sys: {r.unmatched_system} / stmt: {r.unmatched_statement}
                        </div>
                      </div>
                      <Badge variant={STATUS_COLOR[r.status] ?? 'secondary'} className="flex-shrink-0">{r.status}</Badge>
                    </div>
                    <div className="mt-1 text-xs flex justify-between text-muted-foreground">
                      <span>System: ৳ {parseFloat(r.system_closing_balance).toFixed(2)}</span>
                      <span>Stmt: ৳ {parseFloat(r.statement_closing_balance).toFixed(2)}</span>
                      <span className={parseFloat(r.variance) === 0 ? 'text-emerald-600' : 'text-amber-600'}>
                        Var: ৳ {parseFloat(r.variance).toFixed(2)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Detail</CardTitle>
            <CardDescription>Match system ↔ statement lines manually or automatically.</CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedId ? (
              <EmptyState
                icon={<Landmark className="h-8 w-8 text-muted-foreground/50" />}
                message="Select a reconciliation to view its lines."
              />
            ) : detailLoading ? (
              <LoadingState label="Loading detail…" />
            ) : !detail ? (
              <EmptyState message="Reconciliation not found." />
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="border rounded p-2">
                    <div className="text-muted-foreground">System Closing</div>
                    <div className="font-mono font-medium">৳ {parseFloat(detail.system_closing_balance).toFixed(2)}</div>
                  </div>
                  <div className="border rounded p-2">
                    <div className="text-muted-foreground">Statement Closing</div>
                    <div className="font-mono font-medium">৳ {parseFloat(detail.statement_closing_balance).toFixed(2)}</div>
                  </div>
                  <div className="border rounded p-2">
                    <div className="text-muted-foreground">Variance</div>
                    <div className={`font-mono font-medium ${parseFloat(detail.variance) === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      ৳ {parseFloat(detail.variance).toFixed(2)}
                    </div>
                  </div>
                  <div className="border rounded p-2">
                    <div className="text-muted-foreground">Status</div>
                    <div><Badge variant={STATUS_COLOR[detail.status] ?? 'secondary'}>{detail.status}</Badge></div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="min-h-[40px]" onClick={handleAutoMatch} disabled={detail.status === 'reconciled'}>
                    <RefreshCw className="h-4 w-4 mr-1" /> Auto Match
                  </Button>
                  <Button
                    size="sm"
                    className="min-h-[40px]"
                    onClick={handleFinalize}
                    disabled={detail.status === 'reconciled'}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Finalize
                  </Button>
                  {systemLineSelected && (
                    <span className="text-xs text-muted-foreground self-center">
                      Selected system line: <code className="font-mono">{systemLineSelected.slice(0, 8)}</code> — now click a statement line to match.
                      <Button size="sm" variant="ghost" className="ml-2 h-7 px-2" onClick={() => setSystemLineSelected(null)}>Clear</Button>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">System Lines ({systemLines.length})</div>
                    <div className="max-h-72 overflow-y-auto space-y-1">
                      {systemLines.map(l => (
                        <button
                          key={l.id}
                          onClick={() => l.match_status === 'unmatched' && setSystemLineSelected(l.id)}
                          disabled={l.match_status !== 'unmatched'}
                          className={`w-full text-left border rounded p-2 text-xs ${
                            l.match_status === 'unmatched'
                              ? systemLineSelected === l.id
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-slate-50 cursor-pointer'
                              : 'opacity-60 cursor-default'
                          }`}
                        >
                          <div className="flex justify-between gap-2">
                            <span className="truncate">{new Date(l.transaction_date).toLocaleDateString()} · {l.description}</span>
                            <span className="font-mono font-medium">৳ {parseFloat(l.amount).toFixed(2)}</span>
                          </div>
                          <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
                            <span>{l.reference_no ?? '—'}</span>
                            <span className={l.match_status === 'unmatched' ? 'text-amber-600' : 'text-emerald-600'}>{l.match_status}</span>
                          </div>
                        </button>
                      ))}
                      {systemLines.length === 0 && <div className="text-xs text-muted-foreground p-2">No system lines.</div>}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Statement Lines ({statementLines.length})</div>
                    <div className="max-h-72 overflow-y-auto space-y-1">
                      {statementLines.map(l => (
                        <button
                          key={l.id}
                          onClick={() => l.match_status === 'unmatched' && systemLineSelected && handleManualMatch(l.id)}
                          disabled={l.match_status !== 'unmatched' || !systemLineSelected}
                          className={`w-full text-left border rounded p-2 text-xs ${
                            l.match_status === 'unmatched' && systemLineSelected
                              ? 'hover:bg-slate-50 cursor-pointer'
                              : 'opacity-60 cursor-default'
                          }`}
                        >
                          <div className="flex justify-between gap-2">
                            <span className="truncate">{new Date(l.transaction_date).toLocaleDateString()} · {l.description}</span>
                            <span className="font-mono font-medium">৳ {parseFloat(l.amount).toFixed(2)}</span>
                          </div>
                          <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
                            <span>{l.reference_no ?? '—'}</span>
                            <span className={l.match_status === 'unmatched' ? 'text-amber-600' : 'text-emerald-600'}>
                              {l.match_status === 'unmatched' && systemLineSelected ? (
                                <span className="flex items-center gap-1"><Link2 className="h-3 w-3" /> click to match</span>
                              ) : l.match_status}
                            </span>
                          </div>
                        </button>
                      ))}
                      {statementLines.length === 0 && <div className="text-xs text-muted-foreground p-2">No statement lines yet — add some via the API.</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
