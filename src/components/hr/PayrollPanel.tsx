'use client';

// Payroll on the HR page: run payroll for a period, then pay it.
//
// "Run payroll" lists active employees with their base salary filled in; the
// user enters allowances, overtime, deductions and tax withheld, and posts it
// to POST /api/v1/payroll-runs (the server computes and posts every amount,
// and returns the BEFTN bank file, offered as a download). "Pay" sends a
// posted run to POST /api/v1/payroll-runs/{id}/pay from a cash or bank account.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api/client';
import { useWorkflowMutation } from '@/hooks/useWorkflowMutation';
import { useConfirmation } from '@/hooks/useConfirmation';
import { EntityPicker, type BusinessEntity } from '@/components/shared/EntityPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

interface Run { id: string; reference_no: string; status: string; period_start: string; period_end: string; gross_total: string; deduction_total: string; net_total: string }
interface Employee { id: string; name: string; employee_no: string; employment_status: string; base_salary: string }
type Line = { base: string; allowance: string; overtime: string; deduction: string; withholding: string; include: boolean };

const MONEY = /^\d{1,13}(\.\d{1,2})?$/;
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10); };
const monthEnd = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); };

export function PayrollPanel({ can }: { can: (permission: string) => boolean }) {
  const mutation = useWorkflowMutation();
  const { confirm, confirmation } = useConfirmation();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loadError, setLoadError] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(monthEnd());
  const [paying, setPaying] = useState<Run | null>(null);
  const [branch, setBranch] = useState<BusinessEntity | null>(null);
  const [account, setAccount] = useState<BusinessEntity | null>(null);

  const load = useCallback(async () => {
    setLoadError('');
    const r = await apiFetch('/api/v1/payroll-runs'); const data = await r.json().catch(() => ({}));
    if (!r.ok) { setLoadError(data?.error?.message ?? 'Unable to load payroll runs'); return; }
    setRuns(data.items ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function startDraft() {
    const r = await apiFetch('/api/v1/employees?limit=200'); const data = await r.json().catch(() => ({}));
    if (!r.ok) { mutation.setError(data?.error?.message ?? 'Unable to load employees'); return; }
    const active = (data.items ?? []).filter((e: Employee) => e.employment_status === 'active') as Employee[];
    setEmployees(active);
    setLines(Object.fromEntries(active.map(e => [e.id, { base: Number(e.base_salary).toFixed(2), allowance: '0', overtime: '0', deduction: '0', withholding: '0', include: true }])));
    setDrafting(true);
  }
  const set = (id: string, patch: Partial<Line>) => setLines(l => ({ ...l, [id]: { ...l[id], ...patch } }));

  async function post(event: React.FormEvent) {
    event.preventDefault();
    const chosen = employees.filter(e => lines[e.id]?.include);
    if (!chosen.length) { mutation.setError('Include at least one employee.'); return; }
    const bad = chosen.find(e => (['base', 'allowance', 'overtime', 'deduction', 'withholding'] as const).some(k => !MONEY.test(lines[e.id][k].trim() || '0')));
    if (bad) { mutation.setError(`Check the amounts for ${bad.name}: use numbers like 25000 or 25000.50.`); return; }
    if (!start || !end || end < start) { mutation.setError('Choose a period whose end is on or after its start.'); return; }
    if (!await confirm({ title: `Post payroll for ${chosen.length} employees?`, description: 'Salary cost and the amounts owed to staff are recorded now. You pay it in a separate step.', action: 'Post payroll' })) return;
    const result = await mutation.mutate<{ referenceNo: string; netTotal: string; beftnFile?: string }>('/api/v1/payroll-runs', {
      period_start: new Date(`${start}T00:00:00Z`).toISOString(), period_end: new Date(`${end}T23:59:59Z`).toISOString(),
      items: chosen.map(e => ({ employee_id: e.id, base_salary: Number(lines[e.id].base), allowance_total: Number(lines[e.id].allowance || 0),
        overtime_total: Number(lines[e.id].overtime || 0), deduction_total: Number(lines[e.id].deduction || 0), withholding_total: Number(lines[e.id].withholding || 0) })),
    });
    if (result) {
      toast.success(`Payroll ${result.referenceNo} posted. Net pay ৳${result.netTotal}.`);
      if (result.beftnFile) {
        const url = URL.createObjectURL(new Blob([result.beftnFile], { type: 'text/plain' }));
        const a = document.createElement('a'); a.href = url; a.download = `${result.referenceNo}-beftn.txt`; a.click(); URL.revokeObjectURL(url);
      }
      setDrafting(false); await load();
    }
  }

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    if (!paying) return;
    if (!branch || !account) { mutation.setError('Choose the branch and the account the salaries are paid from.'); return; }
    if (!await confirm({ title: `Pay ${paying.reference_no}?`, description: `৳${Number(paying.net_total).toFixed(2)} net pay leaves ${account.name}. This records the salary payment; make the bank transfer itself as usual.`, action: 'Record payment' })) return;
    const result = await mutation.mutate<{ payment_reference: string }>(`/api/v1/payroll-runs/${paying.id}/pay`, { branch_id: branch.id, financial_account_id: account.id });
    if (result) { toast.success(`Payroll paid (${result.payment_reference}).`); setPaying(null); await load(); }
  }

  return (
    <section aria-labelledby="payroll-title" className="space-y-4 rounded-xl border bg-card p-5">
      {confirmation}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="payroll-title" className="text-base font-semibold">Payroll</h2>
        {can('payroll.post') && !drafting ? <Button variant="outline" onClick={() => void startDraft()}>Run payroll</Button> : null}
      </div>
      {loadError ? <p role="alert" className="text-sm text-destructive">{loadError}</p> : null}
      {mutation.error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive">{mutation.error}</p> : null}

      {drafting ? (
        <form onSubmit={post} className="space-y-3 rounded-lg border p-4">
          <fieldset disabled={mutation.pending} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="pr-start">Period start</Label><Input id="pr-start" type="date" value={start} onChange={e => setStart(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="pr-end">Period end</Label><Input id="pr-end" type="date" value={end} onChange={e => setEnd(e.target.value)} /></div>
            </div>
            {employees.length ? (
              <div className="overflow-x-auto"><table className="w-full text-sm tabular-nums"><caption className="sr-only">Pay for each employee this period (৳)</caption>
                <thead><tr className="border-b text-left"><th className="py-2">Pay</th><th>Employee</th><th>Base salary</th><th>Allowances</th><th>Overtime</th><th>Deductions</th><th>Tax withheld</th></tr></thead>
                <tbody>{employees.map(e => (
                  <tr key={e.id} className="border-b">
                    <td className="py-2"><input type="checkbox" className="size-4" aria-label={`Include ${e.name}`} checked={lines[e.id]?.include ?? false} onChange={ev => set(e.id, { include: ev.target.checked })} /></td>
                    <td className="pr-2">{e.name}<span className="block text-xs text-muted-foreground">{e.employee_no}</span></td>
                    {(['base', 'allowance', 'overtime', 'deduction', 'withholding'] as const).map(k => (
                      <td key={k} className="pr-1"><Input aria-label={`${{ base: 'Base salary', allowance: 'Allowances', overtime: 'Overtime', deduction: 'Deductions', withholding: 'Tax withheld' }[k]} for ${e.name}`}
                        inputMode="decimal" className="h-10 min-w-24" value={lines[e.id]?.[k] ?? ''} onChange={ev => set(e.id, { [k]: ev.target.value.trim() })} /></td>
                    ))}
                  </tr>))}</tbody></table></div>
            ) : <p className="text-sm text-muted-foreground">No active employees. Add employees first.</p>}
            <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!employees.length}>Post payroll</Button><Button type="button" variant="outline" onClick={() => setDrafting(false)}>Cancel</Button></div>
          </fieldset>
        </form>
      ) : null}

      {runs.length ? (
        <div className="overflow-x-auto"><table className="w-full text-sm tabular-nums"><caption className="sr-only">Payroll runs</caption>
          <thead><tr className="border-b text-left"><th className="py-2">Run</th><th>Period</th><th>Status</th><th className="text-right">Gross</th><th className="text-right">Net pay</th><th /></tr></thead>
          <tbody>{runs.map(r => (
            <tr key={r.id} className="border-b">
              <td className="py-2">{r.reference_no}</td><td>{r.period_start.slice(0, 10)} – {r.period_end.slice(0, 10)}</td>
              <td><Badge variant={r.status === 'paid' ? 'secondary' : 'default'}>{r.status}</Badge></td>
              <td className="text-right">৳{Number(r.gross_total).toFixed(2)}</td><td className="text-right">৳{Number(r.net_total).toFixed(2)}</td>
              <td className="text-right">{r.status === 'posted' && can('payroll.approve') && can('payment.pay.branch') ? <Button size="sm" variant="outline" onClick={() => { setPaying(r); setAccount(null); }}>Pay</Button> : null}</td>
            </tr>))}</tbody></table></div>
      ) : !drafting ? <p className="text-sm text-muted-foreground">No payroll runs yet.</p> : null}

      {paying ? (
        <form onSubmit={pay} className="space-y-3 rounded-lg border p-4">
          <h3 className="font-medium">Pay {paying.reference_no}</h3>
          <fieldset disabled={mutation.pending} className="grid gap-3 sm:grid-cols-2">
            <EntityPicker label="Paying branch" endpoint="/api/v1/branches" serverSearch={false} value={branch} onChange={next => { setBranch(next); setAccount(null); }} />
            <EntityPicker label="Paid from account" endpoint={`/api/v1/financial-accounts?is_active=true${branch ? `&branch_id=${branch.id}` : ''}`} serverSearch={false} value={account} onChange={setAccount} disabled={!branch} />
          </fieldset>
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={mutation.pending}>Record payment</Button><Button type="button" variant="outline" onClick={() => setPaying(null)}>Cancel</Button></div>
        </form>
      ) : null}
    </section>
  );
}
