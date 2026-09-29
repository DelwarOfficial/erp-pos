// src/app/(erp)/dashboard/collections/reports/page.tsx
// Collection reports: aging, due vs collected per day, collections by
// salesperson, SMS per day. Facts only; the after-reminder figure is labelled
// as a correlation. Consumes: GET /api/v1/collections/reports.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, EmptyState } from '@/components/shared/StateList';
import { apiFetch } from '@/lib/api/client';
import { readError, Taka } from '@/components/collections/common';

interface Report {
  from: string; to: string; as_of: string;
  aging: { not_due: string; days_1_30: string; days_31_60: string; days_61_90: string; days_91_plus: string };
  totals: { due: string; collected: string; collected_within_days_after_reminder: string; attribution_window_days: number;
    sms: { sent: number; delivered: number; failed: number; unknown: number; segments: number } };
  daily: Array<{ day: string; due: string; installments_due: number; collected: string }>;
  sms_daily: Array<{ day: string; sent: number; delivered: number; failed: number; unknown: number; skipped: number; queued: number; segments: number }>;
  by_biller: Array<{ biller_id: string | null; biller_name: string; amount: string; payments: number }>;
}

const iso = (d: Date) => d.toLocaleDateString('en-CA');
const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return iso(d); };
const num = (v: string) => Number(v); // display scaling only; amounts are shown from the strings

function Bar({ value, max, tone }: { value: number; max: number; tone?: 'muted' }) {
  const width = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return <div className="h-2 w-full rounded bg-muted"><div className={`h-2 rounded ${tone === 'muted' ? 'bg-muted-foreground/40' : 'bg-primary'}`} style={{ width: `${width}%` }} /></div>;
}

export default function CollectionReportsPage() {
  const [from, setFrom] = useState(shift(-29));
  const [to, setTo] = useState(iso(new Date()));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await apiFetch(`/api/v1/collections/reports?from=${from}&to=${to}`);
      if (!r.ok) throw new Error(await readError(r));
      setReport(await r.json());
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the report'); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  const aging: Array<[string, string]> = report ? [['Not yet due', report.aging.not_due], ['1–30 days late', report.aging.days_1_30], ['31–60 days late', report.aging.days_31_60],
    ['61–90 days late', report.aging.days_61_90], ['Over 90 days late', report.aging.days_91_plus]] : [];
  const agingMax = Math.max(0, ...aging.map(([, v]) => num(v)));
  const dayMax = report ? Math.max(0, ...report.daily.flatMap(d => [num(d.due), num(d.collected)])) : 0;
  const billerMax = report ? Math.max(0, ...report.by_biller.map(b => num(b.amount))) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/dashboard/collections" className="mb-1 inline-flex items-center text-sm text-muted-foreground hover:underline"><ArrowLeft className="mr-1 h-4 w-4" />Collections</Link>
          <h1 className="text-2xl font-semibold tracking-tight">Collection reports</h1>
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void load(); }}>
          <div className="space-y-1"><Label htmlFor="from">From</Label><Input id="from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="to">To</Label><Input id="to" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <Button type="submit" variant="outline"><RefreshCw className="mr-2 h-4 w-4" />Update</Button>
        </form>
      </div>
      <p className="text-xs text-muted-foreground">At most 92 days. Days are in the company&apos;s time zone.</p>

      {error ? <ErrorState message={error} onRetry={load} /> : loading || !report ? <Skeleton className="h-96" /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardHeader className="pb-2"><CardDescription>Due in the period</CardDescription><CardTitle className="text-2xl"><Taka value={report.totals.due} /></CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Collected in the period</CardDescription><CardTitle className="text-2xl"><Taka value={report.totals.collected} /></CardTitle></CardHeader></Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Collected within {report.totals.attribution_window_days} days after a reminder</CardDescription>
                <CardTitle className="text-2xl"><Taka value={report.totals.collected_within_days_after_reminder} /></CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">Paid after an SMS was sent for that installment. It does not show the SMS caused the payment.</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardDescription>SMS in the period</CardDescription><CardTitle className="text-2xl">{report.totals.sms.sent}</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground">{report.totals.sms.delivered} delivered · {report.totals.sms.failed} failed · {report.totals.sms.unknown} unknown · {report.totals.sms.segments} parts</CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Aging</CardTitle><CardDescription>What is still owed on schedules, by lateness, as of {report.as_of}.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {aging.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[9rem_1fr_7rem] items-center gap-3 text-sm">
                    <span>{label}</span><Bar value={num(value)} max={agingMax} /><Taka value={value} className="text-right" />
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>By salesperson</CardTitle><CardDescription>Collections in the period on sales each person billed.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {report.by_biller.length === 0 ? <EmptyState message="No collections in the period." /> : report.by_biller.map(b => (
                  <div key={b.biller_id ?? 'none'} className="grid grid-cols-[9rem_1fr_7rem] items-center gap-3 text-sm">
                    <span className="truncate">{b.biller_name} <span className="text-muted-foreground">({b.payments})</span></span>
                    <Bar value={num(b.amount)} max={billerMax} /><Taka value={b.amount} className="text-right" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Due and collected per day</CardTitle><CardDescription>Due is what installments were scheduled for that day; collected is what was received that day.</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Day</TableHead><TableHead className="w-1/3">Due</TableHead><TableHead className="text-right" /><TableHead className="w-1/3">Collected</TableHead><TableHead className="text-right" /><TableHead className="text-right">SMS sent</TableHead></TableRow></TableHeader>
                <TableBody>{report.daily.map((d, i) => {
                  const sms = report.sms_daily[i];
                  return (
                    <TableRow key={d.day}>
                      <TableCell className="whitespace-nowrap">{d.day}</TableCell>
                      <TableCell><Bar value={num(d.due)} max={dayMax} tone="muted" /></TableCell>
                      <TableCell className="text-right text-sm"><Taka value={d.due} /></TableCell>
                      <TableCell><Bar value={num(d.collected)} max={dayMax} /></TableCell>
                      <TableCell className="text-right text-sm"><Taka value={d.collected} /></TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{sms ? sms.sent + sms.delivered : 0}{sms && (sms.failed + sms.unknown) > 0 && <span className="text-destructive"> · {sms.failed + sms.unknown} problem</span>}</TableCell>
                    </TableRow>
                  );
                })}</TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
