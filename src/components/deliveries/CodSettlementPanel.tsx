'use client';

// Settle cash-on-delivery money a courier collected.
//
// Lists this courier's delivered COD orders that are not settled yet; the
// user enters what the courier deducted (fee) and any difference in what it
// paid (adjustment), picks the account the money arrived in, and posts it to
// POST /api/v1/courier-settlements. The server checks every order again and
// posts the journal (cash in, courier fee expensed, COD clearing cleared).
// Amounts here are display arithmetic in paisa only; the server decides.

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useWorkflowMutation } from '@/hooks/useWorkflowMutation';
import { useConfirmation } from '@/hooks/useConfirmation';
import { EntityPicker, type BusinessEntity } from '@/components/shared/EntityPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface SettleableDelivery {
  id: string; reference_no: string; status: string; delivery_method: string; courier_code: string | null;
  cod_amount: string; cod_settled?: boolean; branch?: { id: string } | null;
}

const MONEY = /^-?\d{1,15}(\.\d{1,2})?$/;
const paisa = (v: string) => { const n = v.trim(); if (!MONEY.test(n)) return null; const neg = n.startsWith('-'); const [w, d = ''] = n.replace('-', '').split('.'); const p = BigInt(w) * BigInt(100) + BigInt((d + '00').slice(0, 2)); return neg ? -p : p; };
const taka = (p: bigint) => { const neg = p < BigInt(0); const a = neg ? -p : p; return `${neg ? '-' : ''}${a / BigInt(100)}.${String(a % BigInt(100)).padStart(2, '0')}`; };

export function CodSettlementPanel({ deliveries, onSettled }: { deliveries: SettleableDelivery[]; onSettled: () => void }) {
  const mutation = useWorkflowMutation();
  const { confirm, confirmation } = useConfirmation();
  const couriers = useMemo(() => [...new Set(deliveries.filter(d => d.delivery_method === 'courier' && d.courier_code).map(d => d.courier_code!))].sort(), [deliveries]);
  const [courier, setCourier] = useState('');
  const [branch, setBranch] = useState<BusinessEntity | null>(null);
  const [account, setAccount] = useState<BusinessEntity | null>(null);
  const branchId = branch?.id ?? '';
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Record<string, { pick: boolean; fee: string; adjustment: string }>>({});

  const open = deliveries.filter(d => d.delivery_method === 'courier' && d.courier_code === courier && d.status === 'delivered' && !d.cod_settled && Number(d.cod_amount) > 0);
  const row = (id: string) => rows[id] ?? { pick: false, fee: '0', adjustment: '0' };
  const picked = open.filter(d => row(d.id).pick);
  const totals = picked.reduce<{ gross: bigint; fee: bigint; adj: bigint; bad: boolean }>((t, d) => {
    const g = paisa(d.cod_amount); const f = paisa(row(d.id).fee || '0'); const a = paisa(row(d.id).adjustment || '0');
    if (g === null || f === null || a === null || f < BigInt(0)) return { ...t, bad: true };
    return { gross: t.gross + g, fee: t.fee + f, adj: t.adj + a, bad: t.bad };
  }, { gross: BigInt(0), fee: BigInt(0), adj: BigInt(0), bad: false });
  const net = totals.gross - totals.fee + totals.adj;

  async function settle(event: React.FormEvent) {
    event.preventDefault();
    if (!courier) { mutation.setError('Choose the courier.'); return; }
    if (!picked.length) { mutation.setError('Tick the deliveries this payment covers.'); return; }
    if (totals.bad) { mutation.setError('Fees must be zero or more, and amounts like 60 or 60.50.'); return; }
    if (!branch) { mutation.setError('Choose the branch receiving the money.'); return; }
    if (!account) { mutation.setError('Choose the account the money arrived in.'); return; }
    if (net < BigInt(0)) { mutation.setError('The fees are more than the cash collected. Check the amounts.'); return; }
    if (!await confirm({ title: `Settle ${picked.length} deliveries with ${courier}?`,
      description: `COD ৳${taka(totals.gross)} − fee ৳${taka(totals.fee)}${totals.adj !== BigInt(0) ? ` ${totals.adj > BigInt(0) ? '+' : '−'} adjustment ৳${taka(totals.adj < BigInt(0) ? -totals.adj : totals.adj)}` : ''} = ৳${taka(net)} received into ${account.name}. The courier fee is recorded as an expense.`,
      action: 'Post settlement' })) return;
    const result = await mutation.mutate<{ referenceNo?: string }>('/api/v1/courier-settlements', {
      branch_id: branchId, courier_code: courier, settlement_date: new Date(`${date}T00:00:00Z`).toISOString(), financial_account_id: account.id,
      items: picked.map(d => ({ delivery_order_id: d.id, cod_amount: Number(d.cod_amount), fee_amount: Number(row(d.id).fee || '0'), adjustment_amount: Number(row(d.id).adjustment || '0') })),
    });
    if (result) { toast.success(`Settlement ${result.referenceNo ?? ''} posted.`); setRows({}); onSettled(); }
  }

  return (
    <section aria-labelledby="cod-title" className="space-y-3 rounded-xl border bg-card p-5">
      {confirmation}
      <h2 id="cod-title" className="text-base font-semibold">Settle courier COD</h2>
      <p className="text-sm text-muted-foreground">When a courier pays you the cash it collected on delivery, record it here against the deliveries it covers.</p>
      {mutation.error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive">{mutation.error}</p> : null}
      <form onSubmit={settle} className="space-y-3">
        <fieldset disabled={mutation.pending} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <EntityPicker label="Branch" endpoint="/api/v1/branches" serverSearch={false} value={branch} onChange={next => { setBranch(next); setAccount(null); }} />
          <div className="space-y-1.5"><Label htmlFor="cod-courier">Courier</Label>
            <select id="cod-courier" className="h-11 w-full rounded-md border bg-background px-2" value={courier} onChange={e => { setCourier(e.target.value); setRows({}); }}>
              <option value="">Choose…</option>{couriers.map(c => <option key={c} value={c}>{c}</option>)}
            </select></div>
          <EntityPicker label="Money received into" endpoint={`/api/v1/financial-accounts?is_active=true${branchId ? `&branch_id=${branchId}` : ''}`} serverSearch={false} value={account} onChange={setAccount} disabled={!branch} />
          <div className="space-y-1.5"><Label htmlFor="cod-date">Settlement date</Label><Input id="cod-date" type="date" className="h-11" value={date} onChange={e => setDate(e.target.value)} /></div>
        </fieldset>
        {courier ? (open.length ? (
          <div className="overflow-x-auto"><table className="w-full text-sm tabular-nums"><caption className="sr-only">Delivered COD orders not yet settled with {courier}</caption>
            <thead><tr className="border-b text-left"><th className="py-2">Include</th><th>Delivery</th><th className="text-right">COD collected</th><th>Courier fee (৳)</th><th>Adjustment (৳)</th></tr></thead>
            <tbody>{open.map(d => (
              <tr key={d.id} className="border-b">
                <td className="py-2"><input type="checkbox" className="size-4" aria-label={`Include ${d.reference_no}`} checked={row(d.id).pick} onChange={e => setRows(r => ({ ...r, [d.id]: { ...row(d.id), pick: e.target.checked } }))} /></td>
                <td>{d.reference_no}</td><td className="text-right">৳{Number(d.cod_amount).toFixed(2)}</td>
                <td><Input aria-label={`Courier fee for ${d.reference_no}`} inputMode="decimal" className="h-10 max-w-28" value={row(d.id).fee} onChange={e => setRows(r => ({ ...r, [d.id]: { ...row(d.id), fee: e.target.value.trim() } }))} /></td>
                <td><Input aria-label={`Adjustment for ${d.reference_no}`} inputMode="decimal" className="h-10 max-w-28" value={row(d.id).adjustment} onChange={e => setRows(r => ({ ...r, [d.id]: { ...row(d.id), adjustment: e.target.value.trim() } }))} /></td>
              </tr>))}</tbody></table></div>
        ) : <p className="text-sm text-muted-foreground">No delivered COD orders are waiting for settlement with {courier}.</p>) : null}
        {picked.length ? <p role="status" className="text-sm">Collected ৳{taka(totals.gross)} · fee ৳{taka(totals.fee)} · adjustment ৳{taka(totals.adj)} · <strong>received ৳{taka(net)}</strong></p> : null}
        <p className="text-xs text-muted-foreground">Adjustment: positive if the courier paid more than expected, negative if it paid less.</p>
        <Button type="submit" disabled={mutation.pending || !picked.length}>Post settlement</Button>
      </form>
    </section>
  );
}
