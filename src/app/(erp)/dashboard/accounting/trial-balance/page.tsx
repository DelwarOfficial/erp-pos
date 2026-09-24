// src/app/(erp)/dashboard/accounting/trial-balance/page.tsx

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api/client';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';

interface TrialBalanceAccount {
  account_id: string; code: string; name: string;
  account_class: string; normal_balance: string;
  total_debit: string; total_credit: string;
  balance: string; balance_type: string;
}

export default function TrialBalancePage() {
  const [accounts, setAccounts] = useState<TrialBalanceAccount[]>([]);
  const [summary, setSummary] = useState({ total_accounts: 0, total_debit: '0', total_credit: '0', is_balanced: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch('/api/v1/reports/trial-balance')
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 403
          ? 'You do not have permission to view the trial balance.'
          : 'The trial balance could not be loaded. Please retry.');
        return response.json();
      })
      .then(d => {
        if (cancelled) return;
        if (!Array.isArray(d.accounts) || typeof d.summary?.total_accounts !== 'number'
          || typeof d.summary?.total_debit !== 'string' || typeof d.summary?.total_credit !== 'string'
          || typeof d.summary?.is_balanced !== 'boolean') throw new Error('The trial balance response is incomplete. Please retry.');
        setAccounts(d.accounts);
        setSummary(d.summary);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'The trial balance could not be loaded. Please retry.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Scale className="h-6 w-6" /> Trial Balance</h1>
        <p className="text-muted-foreground">Account balances computed from posted journal lines as of today.</p>
      </div>

      {!loading && !error && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&_.text-2xl]:break-words [&_.text-2xl]:tabular-nums">
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{summary.total_accounts}</div><div className="text-xs text-muted-foreground">Accounts</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">৳ {parseFloat(summary.total_debit).toLocaleString()}</div><div className="text-xs text-muted-foreground">Total Debit</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">৳ {parseFloat(summary.total_credit).toLocaleString()}</div><div className="text-xs text-muted-foreground">Total Credit</div></CardContent></Card>
        <Card><CardContent className="pt-4">
          <Badge variant={summary.is_balanced ? 'default' : 'destructive'} className="text-sm">
            {summary.is_balanced ? 'Balanced' : 'Out of Balance'}
          </Badge>
        </CardContent></Card>
      </div>}

      <Card>
        <CardHeader><CardTitle>Account Balances</CardTitle></CardHeader>
        <CardContent>
          {loading ? <LoadingState label="Loading trial balance…" /> : error ? <ErrorState message={error} onRetry={() => setAttempt(value => value + 1)} /> : accounts.length === 0 ? (
            <EmptyState message="No posted journal entries yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2">Code</th><th>Account</th><th>Class</th>
                    <th className="text-right">Debit</th><th className="text-right">Credit</th>
                    <th className="text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map(a => (
                    <tr key={a.account_id} className="border-b hover:bg-muted">
                      <td className="py-2 font-mono">{a.code}</td>
                      <td>{a.name}</td>
                      <td><Badge variant="outline" className="text-xs">{a.account_class}</Badge></td>
                      <td className="text-right font-mono">{parseFloat(a.total_debit).toFixed(2)}</td>
                      <td className="text-right font-mono">{parseFloat(a.total_credit).toFixed(2)}</td>
                      <td className={`text-right font-mono font-medium ${a.balance_type === 'Debit' ? 'text-info-foreground' : 'text-success-foreground'}`}>
                        {a.balance_type === 'Debit' ? 'Dr' : 'Cr'} {Math.abs(parseFloat(a.balance)).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
