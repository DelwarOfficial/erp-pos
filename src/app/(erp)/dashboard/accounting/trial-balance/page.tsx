// src/app/(erp)/dashboard/accounting/trial-balance/page.tsx

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Scale } from 'lucide-react';
import { toast } from 'sonner';

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

  useEffect(() => {
    fetch('/api/v1/reports/trial-balance')
      .then(r => r.json())
      .then(d => {
        setAccounts(d.accounts ?? []);
        setSummary(d.summary ?? {});
      })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Scale className="h-6 w-6" /> Trial Balance</h1>
        <p className="text-muted-foreground">Account balances computed from posted journal lines as of today.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{summary.total_accounts}</div><div className="text-xs text-muted-foreground">Accounts</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">৳ {parseFloat(summary.total_debit).toLocaleString()}</div><div className="text-xs text-muted-foreground">Total Debit</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">৳ {parseFloat(summary.total_credit).toLocaleString()}</div><div className="text-xs text-muted-foreground">Total Credit</div></CardContent></Card>
        <Card><CardContent className="pt-4">
          <Badge variant={summary.is_balanced ? 'default' : 'destructive'} className="text-sm">
            {summary.is_balanced ? 'Balanced' : 'Out of Balance'}
          </Badge>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Account Balances</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : accounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No posted journal entries yet.</div>
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
                    <tr key={a.account_id} className="border-b hover:bg-slate-50">
                      <td className="py-2 font-mono">{a.code}</td>
                      <td>{a.name}</td>
                      <td><Badge variant="outline" className="text-xs">{a.account_class}</Badge></td>
                      <td className="text-right font-mono">{parseFloat(a.total_debit).toFixed(2)}</td>
                      <td className="text-right font-mono">{parseFloat(a.total_credit).toFixed(2)}</td>
                      <td className={`text-right font-mono font-medium ${a.balance_type === 'Debit' ? 'text-blue-600' : 'text-green-600'}`}>
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
