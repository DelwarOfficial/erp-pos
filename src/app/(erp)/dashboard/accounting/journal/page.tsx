// src/app/(erp)/dashboard/accounting/journal/page.tsx
// Journal entries list + create form.

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, BookOpen } from 'lucide-react';
import { toast } from 'sonner';

interface JournalEntry {
  id: string; entry_no: string; status: string;
  entry_date: string; description: string;
  total_debit: string; total_credit: string; line_count: number;
  lines: Array<{
    line_no: number; account: { code: string; name: string };
    debit: string; credit: string; memo: string | null;
  }>;
}

interface ChartOfAccount { id: string; code: string; name: string; account_class: string }

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [coa, setCoa] = useState<ChartOfAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [posting, setPosting] = useState(false);
  const [form, setForm] = useState({
    description: '', entry_date: new Date().toISOString().slice(0, 10),
    lines: [
      { chart_of_account_id: '', debit: '0', credit: '0', memo: '' },
      { chart_of_account_id: '', debit: '0', credit: '0', memo: '' },
    ],
  });

  useEffect(() => {
    loadEntries();
    fetch('/api/v1/chart-of-accounts?limit=200').then(r => r.json()).then(d => setCoa(d.items ?? [])).catch(console.error);
  }, []);

  async function loadEntries() {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/journal-entries?limit=20');
      const data = await res.json();
      setEntries(data.items ?? []);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }

  function updateLine(idx: number, field: string, value: string) {
    setForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, [field]: value } : l) }));
  }
  function addLine() {
    setForm(f => ({ ...f, lines: [...f.lines, { chart_of_account_id: '', debit: '0', credit: '0', memo: '' }] }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPosting(true);
    try {
      const idempotencyKey = `je-${Date.now()}`;
      const res = await fetch('/api/v1/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          description: form.description,
          entry_date: new Date(form.entry_date).toISOString(),
          lines: form.lines.map(l => ({
            chart_of_account_id: l.chart_of_account_id,
            debit: Number(l.debit), credit: Number(l.credit),
            memo: l.memo || undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success(`Journal ${data.entry_no} posted — Dr ${data.total_debit} / Cr ${data.total_credit}`);
      setShowForm(false);
      await loadEntries();
    } finally { setPosting(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6" /> Journal Entries</h1>
        <Button onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4 mr-2" /> New Entry</Button>
      </div>

      {showForm && (
        <Card>
          <form onSubmit={handleSubmit}>
            <CardHeader><CardTitle className="text-base">New Journal Entry</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Description *</Label>
                  <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required />
                </div>
                <div>
                  <Label>Entry Date *</Label>
                  <Input type="date" value={form.entry_date} onChange={e => setForm({ ...form, entry_date: e.target.value })} required />
                </div>
              </div>
              <div className="border-t pt-3 space-y-2">
                {form.lines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-5">
                      <Label className="text-xs">Account</Label>
                      <Select value={line.chart_of_account_id} onValueChange={v => updateLine(idx, 'chart_of_account_id', v)}>
                        <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                        <SelectContent>
                          {coa.map(a => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Debit</Label>
                      <Input type="number" step="0.01" value={line.debit} onChange={e => updateLine(idx, 'debit', e.target.value)} />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Credit</Label>
                      <Input type="number" step="0.01" value={line.credit} onChange={e => updateLine(idx, 'credit', e.target.value)} />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Memo</Label>
                      <Input value={line.memo} onChange={e => updateLine(idx, 'memo', e.target.value)} />
                    </div>
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={addLine}><Plus className="h-3 w-3 mr-1" /> Add Line</Button>
              </div>
              <div className="text-sm font-medium">
                Total Debit: ৳ {form.lines.reduce((s, l) => s + Number(l.debit), 0).toFixed(2)} |
                Total Credit: ৳ {form.lines.reduce((s, l) => s + Number(l.credit), 0).toFixed(2)}
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" disabled={posting}>
                {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Post Entry
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Entries ({entries.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : entries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No journal entries yet.</div>
          ) : (
            <div className="space-y-2">
              {entries.map(e => (
                <div key={e.id} className="border rounded p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-sm font-medium">{e.entry_no}</code>
                      <Badge variant={e.status === 'posted' ? 'default' : e.status === 'reversed' ? 'destructive' : 'secondary'}>{e.status}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(e.entry_date).toLocaleDateString()}</span>
                  </div>
                  <div className="text-sm mt-1">{e.description}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Dr ৳ {e.total_debit} | Cr ৳ {e.total_credit} | {e.line_count} lines
                  </div>
                  {e.lines && e.lines.length > 0 && (
                    <div className="mt-2 pl-4 border-l-2 space-y-1">
                      {e.lines.map(l => (
                        <div key={l.line_no} className="text-xs flex justify-between">
                          <span><code>{l.account.code}</code> {l.account.name} {l.memo && `— ${l.memo}`}</span>
                          <span className="font-mono">
                            {parseFloat(l.debit) > 0 ? `Dr ${l.debit}` : `Cr ${l.credit}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
