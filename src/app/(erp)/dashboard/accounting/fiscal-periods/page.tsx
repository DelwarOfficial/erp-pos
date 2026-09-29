'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useWorkflowMutation } from '@/hooks/useWorkflowMutation';
import { useDashboardSession } from '@/components/dashboard/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

interface Period { id: string; period_name: string; period_start: string; period_end: string; status: string; locked_at: string | null }
export default function FiscalPeriodsPage() {
  const session = useDashboardSession();
  const [items, setItems] = useState<Period[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(''); const [start, setStart] = useState(''); const [end, setEnd] = useState('');
  const command = useWorkflowMutation();
  const load = useCallback(async (next?: string) => {
    setLoading(true); setError('');
    try {
      const response = await apiFetch(`/api/v1/fiscal-periods?limit=50${next ? `&cursor=${next}` : ''}`); const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? 'Unable to load fiscal periods');
      setItems(current => next ? [...current, ...data.items] : data.items); setCursor(data.has_more ? data.next_cursor : null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load fiscal periods'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    const result = await command.mutate('/api/v1/fiscal-periods', { period_name: name.trim(), period_start: new Date(start).toISOString(), period_end: new Date(`${end}T23:59:59.999Z`).toISOString() });
    if (result) { toast.success('Fiscal period created.'); setCreating(false); setName(''); setStart(''); setEnd(''); await load(); }
  }
  return <div className="space-y-5"><div className="flex flex-wrap justify-between gap-3"><h1 className="text-2xl font-bold">Fiscal periods</h1><div className="flex gap-2"><Button variant="outline" disabled={loading} onClick={() => void load()}>Refresh</Button>{session?.is_global || session?.permissions.includes('fiscal_period.lock') ? <Button onClick={() => setCreating(true)}>New fiscal period</Button> : null}</div></div>
    {error || command.error ? <p role="alert">{error || command.error}</p> : null}{loading ? <p role="status">Loading fiscal periods…</p> : null}
    {creating ? <Card><CardHeader><CardTitle>New fiscal period</CardTitle></CardHeader><CardContent><form onSubmit={create}><fieldset disabled={command.pending} className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor="period-name">Name</Label><Input id="period-name" required maxLength={50} value={name} onChange={e => setName(e.target.value)} /></div><div><Label htmlFor="period-start">Start date</Label><Input id="period-start" type="date" required value={start} onChange={e => setStart(e.target.value)} /></div><div><Label htmlFor="period-end">End date</Label><Input id="period-end" type="date" required min={start || undefined} value={end} onChange={e => setEnd(e.target.value)} /></div><div className="flex gap-2 sm:col-span-3"><Button type="submit">Create period</Button><Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button></div></fieldset></form></CardContent></Card> : null}
    <Card><CardContent className="pt-5">{!loading && !items.length ? <p>No fiscal periods configured.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th>Period</th><th>Start</th><th>End</th><th>Status</th><th>Locked</th></tr></thead><tbody>{items.map(period => <tr key={period.id} className="border-b"><td className="py-3 pr-3 font-medium">{period.period_name}</td><td>{new Date(period.period_start).toLocaleDateString()}</td><td>{new Date(period.period_end).toLocaleDateString()}</td><td><Badge variant="secondary">{period.status}</Badge></td><td>{period.locked_at ? new Date(period.locked_at).toLocaleString() : '—'}</td></tr>)}</tbody></table></div>}{cursor ? <Button variant="outline" disabled={loading} className="mt-4" onClick={() => void load(cursor)}>Load more periods</Button> : null}</CardContent></Card>
  </div>;
}
