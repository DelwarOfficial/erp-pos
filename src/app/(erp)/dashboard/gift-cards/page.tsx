// src/app/(erp)/dashboard/gift-cards/page.tsx
// Gift card management.

'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Gift, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api/client';

interface GiftCard {
  id: string;
  code: string;
  status: string;
  face_value: string;
  issued_at: string;
  expires_at: string | null;
}

export default function GiftCardsPage() {
  const [items, setItems] = useState<GiftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [faceValue, setFaceValue] = useState('1000');
  const [posting, setPosting] = useState(false);
  const [mode, setMode] = useState('');
  const [branchId, setBranchId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [cashReceived, setCashReceived] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; branch?: { id: string } | null; currency_code?: string }>>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ key: string; body: string } | null>(null);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!showForm || !mode) return;
    let cancelled = false;
    setOptionsLoading(true);
    setAccounts([]);
    setAccountId('');
    void (async () => {
      try {
        const [branchResponse, accountResponse] = await Promise.all([
          apiFetch('/api/v1/branches'),
          apiFetch(mode === 'sold' ? '/api/v1/financial-accounts' : '/api/v1/chart-of-accounts'),
        ]);
        if (!branchResponse.ok || !accountResponse.ok) throw new Error('Cannot load authorized branches/accounts. Check read permissions.');
        const branchData = await branchResponse.json();
        const accountData = await accountResponse.json();
        if (!cancelled) {
          setBranches(branchData.items ?? []);
          setAccounts((accountData.items ?? []).filter((a: { is_active: boolean; account_type?: string; account_class?: string; normal_balance?: string; allow_manual_posting?: boolean; is_control_account?: boolean }) =>
            a.is_active && (mode === 'sold' ? a.account_type === 'cash'
              : a.account_class === 'expense' && a.normal_balance === 'D' && a.allow_manual_posting && !a.is_control_account)));
        }
      } catch (error) { if (!cancelled) toast.error(error instanceof Error ? error.message : 'Cannot load issuance options'); }
      finally { if (!cancelled) setOptionsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [showForm, mode]);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch('/api/v1/gift-cards');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load gift cards');
      setItems(data.items ?? []);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }

  async function handleIssue(e: React.FormEvent) {
    e.preventDefault();
    if (posting) return;
    setPosting(true);
    try {
      if (!pending.current) pending.current = { key: `gc-${crypto.randomUUID()}`, body: JSON.stringify({
        face_value: faceValue, branch_id: branchId, mode,
        ...(mode === 'sold' ? { financial_account_id: accountId, cash_received: cashReceived } : { expense_account_id: accountId }),
      }) };
      const res = await apiFetch('/api/v1/gift-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key },
        body: pending.current.body,
      });
      const data = await res.json();
      if (!res.ok) {
        const retry = res.status >= 500 || data?.error?.code === 'CONCURRENT_MODIFICATION';
        setUncertain(retry);
        if (!retry) pending.current = null;
        toast.error(data?.error?.message ?? 'Failed'); return;
      }
      pending.current = null;
      setUncertain(false);
      setCashReceived(false);
      toast.success(`Gift card ${data.code} issued — ${data.face_value} in company base currency`);
      setShowForm(false);
      await load();
    } catch {
      setUncertain(true);
      toast.error('Issuance result unknown. Retry this same request; do not collect cash again.');
    } finally { setPosting(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Gift className="h-6 w-6" /> Gift Cards</h1>
          <p className="text-muted-foreground">Issue and track gift card liability.</p>
        </div>
        <Button disabled={posting || uncertain} onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4 mr-2" /> Issue Card</Button>
      </div>

      {showForm && (
        <Card>
          <form onSubmit={handleIssue}>
            <CardHeader><CardTitle className="text-base">Issue New Gift Card</CardTitle></CardHeader>
            <CardContent>
              <fieldset disabled={posting || uncertain} className="space-y-3">
                <Label htmlFor="gift-mode">Issuance mode</Label>
                <select id="gift-mode" className="w-full border rounded p-2" value={mode} onChange={e => setMode(e.target.value)} required>
                  <option value="">Select mode</option><option value="sold">Sold — cash received</option><option value="promotional">Promotional — marketing expense</option>
                </select>
                <Label htmlFor="gift-branch">Branch</Label>
                <select id="gift-branch" className="w-full border rounded p-2" value={branchId} onChange={e => { setBranchId(e.target.value); setAccountId(''); }} required>
                  <option value="">Select branch</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <Label htmlFor="gift-account">{mode === 'sold' ? 'Branch cash account (company base currency only)' : 'Authorized marketing expense account'}</Label>
                <select id="gift-account" className="w-full border rounded p-2" value={accountId} onChange={e => setAccountId(e.target.value)} required disabled={optionsLoading}>
                  <option value="">{optionsLoading ? 'Loading accounts…' : 'Select account'}</option>
                  {accounts.filter(a => mode !== 'sold' || a.branch?.id === branchId).map(a => <option key={a.id} value={a.id}>{a.name}{a.currency_code ? ` (${a.currency_code})` : ''}</option>)}
                </select>
                <Label htmlFor="gift-value">Face value (company base currency)</Label>
                <Input id="gift-value" type="number" min="0.01" max="999999999999.99" step="0.01" value={faceValue} onChange={e => setFaceValue(e.target.value)} required />
                {mode === 'sold' && <label className="flex gap-2"><input type="checkbox" checked={cashReceived} onChange={e => setCashReceived(e.target.checked)} required />Cash has been received in full. This creates the receipt and liability.</label>}
              </fieldset>
              {uncertain && <p role="alert">Result unknown. Retry uses the same request/key. Do not collect cash again or reload this page.</p>}
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={posting || optionsLoading || !mode || !branchId || !accountId}>{posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}{uncertain ? 'Retry same issuance' : 'Issue'}</Button>
            </CardFooter>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Cards ({items.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No gift cards yet.</div>
          ) : (
            <div className="space-y-2">
              {items.map(c => (
                <div key={c.id} className="flex items-center justify-between border rounded p-3">
                  <div className="flex items-center gap-3">
                    <code className="font-mono text-sm font-medium">{c.code}</code>
                    <Badge variant={c.status === 'active' ? 'default' : c.status === 'redeemed' ? 'secondary' : 'destructive'}>
                      {c.status}
                    </Badge>
                  </div>
                  <div className="text-right">
                    <div className="font-mono">৳ {parseFloat(c.face_value).toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">{new Date(c.issued_at).toLocaleDateString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
