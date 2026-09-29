// src/app/(erp)/dashboard/collections/calendar/page.tsx
// Due calendar: per day, installments still owed, promises to pay and open
// follow-ups. Clicking a day opens the worklist for it.
// Consumes: GET /api/v1/collections/calendar?month=YYYY-MM.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/StateList';
import { apiFetch } from '@/lib/api/client';
import { readError, Taka } from '@/components/collections/common';

interface Day { day: string; installments: number; customers: number; outstanding: string; promises: number; promised_amount: string; follow_ups: number }
interface Calendar { month: string; today: string; days: Day[] }

const WEEKDAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']; // Bangladesh week starts Saturday
function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function CollectionCalendarPage() {
  const [month, setMonth] = useState(() => new Date().toLocaleDateString('en-CA').slice(0, 7));
  const [data, setData] = useState<Calendar | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null); setData(null);
    try {
      const r = await apiFetch(`/api/v1/collections/calendar?month=${month}`);
      if (!r.ok) throw new Error(await readError(r));
      setData(await r.json());
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the calendar'); }
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  const lead = data ? (new Date(`${data.days[0].day}T00:00:00Z`).getUTCDay() + 1) % 7 : 0;
  const title = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/collections" className="mb-1 inline-flex items-center text-sm text-muted-foreground hover:underline"><ArrowLeft className="mr-1 h-4 w-4" />Collections</Link>
        <h1 className="text-2xl font-semibold tracking-tight">Due calendar</h1>
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>Amounts are what is still owed. A promise date is shown next to, never instead of, the due date.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth(m => addMonths(m, -1))}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" onClick={() => setMonth(new Date().toLocaleDateString('en-CA').slice(0, 7))}>This month</Button>
            <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonth(m => addMonths(m, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Skeleton className="h-96" /> : (
            <div className="grid grid-cols-7 gap-1 text-xs sm:gap-2">
              {WEEKDAYS.map(w => <div key={w} className="pb-1 text-center font-medium text-muted-foreground">{w}</div>)}
              {Array.from({ length: lead }, (_, i) => <div key={`blank-${i}`} />)}
              {data.days.map(d => {
                const past = d.day < data.today;
                const busy = d.installments > 0 || d.promises > 0 || d.follow_ups > 0;
                return (
                  <div key={d.day} className={`min-h-20 rounded-md border p-1.5 ${d.day === data.today ? 'border-primary' : ''} ${busy ? '' : 'opacity-60'}`}>
                    <div className="font-medium">{Number(d.day.slice(8))}</div>
                    {d.installments > 0 && (
                      <Link href={`/dashboard/collections?view=${past ? 'overdue' : d.day === data.today ? 'due_today' : 'upcoming'}`} className={`block hover:underline ${past ? 'text-destructive' : ''}`}>
                        <Taka value={d.outstanding} /><span className="hidden text-muted-foreground sm:inline"> · {d.customers} cust.</span>
                      </Link>
                    )}
                    {d.promises > 0 && <div className="text-muted-foreground">{d.promises} promise{d.promises === 1 ? '' : 's'}</div>}
                    {d.follow_ups > 0 && <div className="text-muted-foreground">{d.follow_ups} follow-up{d.follow_ups === 1 ? '' : 's'}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
