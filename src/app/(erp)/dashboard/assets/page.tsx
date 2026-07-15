// src/app/(erp)/dashboard/assets/page.tsx
// Fixed Asset register — list, acquire, depreciate, dispose.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Building, Plus, RefreshCw, ArrowDownToLine, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';

interface Asset {
  id: string;
  asset_code: string;
  name: string;
  status: string;
  purchase_date: string;
  purchase_cost: string;
  salvage_value: string;
  accumulated_depreciation: string;
  net_book_value: string;
  useful_life_months: number;
  depreciation_method: string;
  branch: { id: string; name: string; code: string } | null;
  category: { id: string; name: string; code: string } | null;
}

interface CoaAccount {
  id: string;
  code: string;
  name: string;
}

interface FinancialAccount {
  id: string;
  name: string;
  account_type: string;
}

const STATUS_COLOR: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  fully_depreciated: 'secondary',
  disposed: 'destructive',
  impaired: 'outline',
};

export default function FixedAssetsPage() {
  const [items, setItems] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // CoA + financial accounts for the acquisition form
  const [coaAccounts, setCoaAccounts] = useState<CoaAccount[]>([]);
  const [financialAccounts, setFinancialAccounts] = useState<FinancialAccount[]>([]);

  // Form state
  const [assetCode, setAssetCode] = useState('');
  const [name, setName] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [purchaseCost, setPurchaseCost] = useState('10000');
  const [salvageValue, setSalvageValue] = useState('0');
  const [usefulLifeMonths, setUsefulLifeMonths] = useState('60');
  const [method, setMethod] = useState('straight_line');
  const [depRate, setDepRate] = useState('20');
  const [assetAccountId, setAssetAccountId] = useState('');
  const [accumDepAccountId, setAccumDepAccountId] = useState('');
  const [depExpenseAccountId, setDepExpenseAccountId] = useState('');
  const [gainLossAccountId, setGainLossAccountId] = useState('');
  const [financialAccountId, setFinancialAccountId] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/fixed-assets?limit=200');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load assets');
      setItems(data.items ?? []);
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
      const [coaRes, faRes] = await Promise.all([
        fetch('/api/v1/chart-of-accounts'),
        fetch('/api/v1/financial-accounts'),
      ]);
      const coaData = await coaRes.json();
      const faData = await faRes.json();
      if (coaRes.ok) setCoaAccounts(coaData.items ?? []);
      if (faRes.ok) setFinancialAccounts(faData.items ?? []);

      // Pre-select asset-related accounts if codes 1810/1850/1860/1870 exist
      const findByCode = (code: string) => coaData.items?.find((c: CoaAccount) => c.code === code)?.id;
      setAssetAccountId(prev => prev || findByCode('1810') || findByCode('1800') || '');
      setAccumDepAccountId(prev => prev || findByCode('1850') || '');
      setDepExpenseAccountId(prev => prev || findByCode('1860') || '');
      setGainLossAccountId(prev => prev || findByCode('1870') || '');
    } catch (e) {
      // non-fatal
      console.warn('Failed to load CoA/FA', e);
    }
  }, []);

  useEffect(() => { load(); loadFormData(); }, [load, loadFormData]);

  async function handleAcquire(e: React.FormEvent) {
    e.preventDefault();
    if (!assetAccountId || !accumDepAccountId || !depExpenseAccountId || !financialAccountId) {
      toast.error('Please select all GL + financial accounts');
      return;
    }
    setPosting(true);
    try {
      const idempotencyKey = `fa-${Date.now()}`;
      const res = await fetch('/api/v1/fixed-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          asset_code: assetCode,
          name,
          purchase_date: purchaseDate,
          purchase_cost: Number(purchaseCost),
          salvage_value: Number(salvageValue),
          useful_life_months: Number(usefulLifeMonths),
          depreciation_method: method,
          depreciation_rate: method === 'declining_balance' ? Number(depRate) : undefined,
          asset_account_id: assetAccountId,
          accum_dep_account_id: accumDepAccountId,
          dep_expense_account_id: depExpenseAccountId,
          gain_loss_account_id: gainLossAccountId || undefined,
          financial_account_id: financialAccountId,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success(`Asset ${data.asset_code} acquired — ৳ ${data.net_book_value}`);
      setShowForm(false);
      setAssetCode(''); setName('');
      await load();
    } catch (e) {
      toast.error('Failed to acquire asset: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally { setPosting(false); }
  }

  async function handleDepreciate(asset: Asset) {
    if (asset.status !== 'active') {
      toast.error(`Cannot depreciate an asset with status "${asset.status}"`);
      return;
    }
    // Default period: previous month
    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
    try {
      const idempotencyKey = `dep-${asset.id}-${Date.now()}`;
      const res = await fetch(`/api/v1/fixed-assets/${asset.id}/depreciate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success(`Depreciated ৳ ${data.depreciation_amount} — NBV now ৳ ${data.net_book_value_after}`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Network error'); }
  }

  async function handleDispose(asset: Asset) {
    const reason = window.prompt(`Dispose asset "${asset.asset_code} — ${asset.name}". Enter method: sold / scrapped / donated`, 'scrapped');
    if (!reason) return;
    if (!['sold', 'scrapped', 'donated'].includes(reason)) {
      toast.error('Method must be sold / scrapped / donated');
      return;
    }
    const amountStr = window.prompt('Disposal amount (sale proceeds — 0 for scrapped/donated)', '0');
    if (amountStr === null) return;
    const amount = Number(amountStr);
    if (Number.isNaN(amount) || amount < 0) { toast.error('Invalid amount'); return; }

    try {
      const idempotencyKey = `disp-${asset.id}-${Date.now()}`;
      const res = await fetch(`/api/v1/fixed-assets/${asset.id}/dispose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          disposed_at: new Date().toISOString(),
          disposal_amount: amount,
          disposal_method: reason,
          financial_account_id: amount > 0 ? financialAccountId || undefined : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      const gl = Number(data.gain_or_loss);
      toast.success(`Disposed — ${gl >= 0 ? 'gain' : 'loss'} ৳ ${Math.abs(gl).toFixed(2)}`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Network error'); }
  }

  const totalCost = items.reduce((s, a) => s + parseFloat(a.purchase_cost), 0);
  const totalAccum = items.reduce((s, a) => s + parseFloat(a.accumulated_depreciation), 0);
  const totalNbv = items.reduce((s, a) => s + parseFloat(a.net_book_value), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Building className="h-6 w-6" /> Fixed Assets</h1>
          <p className="text-muted-foreground">Asset register with depreciation tracking and disposal accounting.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="min-h-[44px]" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button className="min-h-[44px]" onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4 mr-2" /> Acquire Asset
          </Button>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Assets</CardDescription></CardHeader>
          <CardContent><CardTitle className="text-2xl">{items.length}</CardTitle></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Purchase Cost (BDT)</CardDescription></CardHeader>
          <CardContent><CardTitle className="text-xl md:text-2xl">৳ {totalCost.toLocaleString('en-BD', { maximumFractionDigits: 2 })}</CardTitle></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Accumulated Dep. (BDT)</CardDescription></CardHeader>
          <CardContent><CardTitle className="text-xl md:text-2xl">৳ {totalAccum.toLocaleString('en-BD', { maximumFractionDigits: 2 })}</CardTitle></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Net Book Value (BDT)</CardDescription></CardHeader>
          <CardContent><CardTitle className="text-xl md:text-2xl">৳ {totalNbv.toLocaleString('en-BD', { maximumFractionDigits: 2 })}</CardTitle></CardContent>
        </Card>
      </div>

      {showForm && (
        <Card>
          <form onSubmit={handleAcquire}>
            <CardHeader>
              <CardTitle className="text-base">Acquire New Fixed Asset</CardTitle>
              <CardDescription>Capitalise the asset and post the acquisition journal entry.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="asset_code">Asset Code</Label>
                  <Input id="asset_code" value={assetCode} onChange={e => setAssetCode(e.target.value)} required placeholder="FA-001" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="name">Asset Name</Label>
                  <Input id="name" value={name} onChange={e => setName(e.target.value)} required placeholder="Delivery van — Dhaka" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="purchase_date">Purchase Date</Label>
                  <Input id="purchase_date" type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="purchase_cost">Purchase Cost (BDT)</Label>
                  <Input id="purchase_cost" type="number" min="0" step="0.01" value={purchaseCost} onChange={e => setPurchaseCost(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="salvage_value">Salvage Value (BDT)</Label>
                  <Input id="salvage_value" type="number" min="0" step="0.01" value={salvageValue} onChange={e => setSalvageValue(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="useful_life_months">Useful Life (months)</Label>
                  <Input id="useful_life_months" type="number" min="1" step="1" value={usefulLifeMonths} onChange={e => setUsefulLifeMonths(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Depreciation Method</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="straight_line">Straight Line</SelectItem>
                      <SelectItem value="declining_balance">Declining Balance</SelectItem>
                      <SelectItem value="units_of_production">Units of Production</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {method === 'declining_balance' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="dep_rate">Depreciation Rate (% / year)</Label>
                    <Input id="dep_rate" type="number" min="0" max="100" step="0.1" value={depRate} onChange={e => setDepRate(e.target.value)} />
                  </div>
                )}
              </div>

              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Asset GL Account (Dr)</Label>
                  <Select value={assetAccountId} onValueChange={setAssetAccountId}>
                    <SelectTrigger><SelectValue placeholder="Select asset account" /></SelectTrigger>
                    <SelectContent>
                      {coaAccounts.map(c => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Accumulated Dep. Account (Cr)</Label>
                  <Select value={accumDepAccountId} onValueChange={setAccumDepAccountId}>
                    <SelectTrigger><SelectValue placeholder="Select accum dep account" /></SelectTrigger>
                    <SelectContent>
                      {coaAccounts.map(c => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Depreciation Expense Account</Label>
                  <Select value={depExpenseAccountId} onValueChange={setDepExpenseAccountId}>
                    <SelectTrigger><SelectValue placeholder="Select dep expense account" /></SelectTrigger>
                    <SelectContent>
                      {coaAccounts.map(c => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Gain/Loss on Disposal Account (optional)</Label>
                  <Select value={gainLossAccountId} onValueChange={setGainLossAccountId}>
                    <SelectTrigger><SelectValue placeholder="(optional)" /></SelectTrigger>
                    <SelectContent>
                      {coaAccounts.map(c => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Payment Account (Cr Cash/Bank)</Label>
                  <Select value={financialAccountId} onValueChange={setFinancialAccountId}>
                    <SelectTrigger><SelectValue placeholder="Select financial account" /></SelectTrigger>
                    <SelectContent>
                      {financialAccounts.map(f => <SelectItem key={f.id} value={f.id}>{f.name} ({f.account_type})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
            <CardFooter className="gap-2">
              <Button type="submit" disabled={posting} className="min-h-[44px]">
                {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Acquire Asset
              </Button>
              <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setShowForm(false)}>Cancel</Button>
            </CardFooter>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Asset Register ({items.length})</CardTitle>
          <CardDescription>Net book value is recomputed on every depreciation run.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingState label="Loading assets…" />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Building className="h-8 w-8 text-muted-foreground/50" />}
              message={<>No fixed assets recorded yet. Click <strong>Acquire Asset</strong> to capitalise a new asset.</>}
            />
          ) : (
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-sm min-w-[920px]">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Code</th>
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Branch</th>
                    <th className="py-2 pr-3 font-medium">Purchased</th>
                    <th className="py-2 pr-3 font-medium text-right">Cost</th>
                    <th className="py-2 pr-3 font-medium text-right">Accum. Dep.</th>
                    <th className="py-2 pr-3 font-medium text-right">NBV</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(a => (
                    <tr key={a.id} className="border-b hover:bg-slate-50">
                      <td className="py-2 pr-3 font-mono text-xs">{a.asset_code}</td>
                      <td className="py-2 pr-3">{a.name}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{a.branch?.code ?? '—'}</td>
                      <td className="py-2 pr-3 text-xs">{new Date(a.purchase_date).toLocaleDateString()}</td>
                      <td className="py-2 pr-3 text-right font-mono">৳ {parseFloat(a.purchase_cost).toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right font-mono">৳ {parseFloat(a.accumulated_depreciation).toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right font-mono font-medium">৳ {parseFloat(a.net_book_value).toFixed(2)}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={STATUS_COLOR[a.status] ?? 'secondary'}>{a.status}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2"
                            onClick={() => handleDepreciate(a)}
                            disabled={a.status !== 'active'}
                            title="Run depreciation"
                          >
                            <ArrowDownToLine className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-destructive"
                            onClick={() => handleDispose(a)}
                            disabled={a.status === 'disposed'}
                            title="Dispose"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
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
