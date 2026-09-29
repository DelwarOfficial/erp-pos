// Daily follow-through lists for the collections page: follow-ups that are
// due (overdue first) and promises to pay that were missed.
// Consumes: GET /api/v1/collections/follow-ups, POST /api/v1/collections/follow-ups/{id}/close,
//           GET /api/v1/collections/promises?status=broken.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, EmptyState } from '@/components/shared/StateList';
import { apiFetch } from '@/lib/api/client';
import { newIdempotencyKey, readError, Taka, useCan } from './common';
import { FOLLOW_UP_LABELS } from './FollowThrough';

interface FollowUp {
  id: string; followUpType: string; dueAt: string; note: string | null;
  customer: { id: string; name: string }; sale: { referenceNo: string } | null; installment: { installmentNo: number } | null;
  assignee: { name: string } | null;
}
interface MissedPromise {
  id: string; customer_id: string; customer_name: string; reference_no: string; installment_no: number | null;
  promised_date: string; promised_amount: string; collected: string; recorded_by_name: string;
}

export function FollowUpQueue({ refreshKey }: { refreshKey?: number }) {
  const can = useCan();
  const [tab, setTab] = useState<'follow_ups' | 'missed'>('follow_ups');
  const [who, setWho] = useState<'me' | 'all'>('me');
  const [followUps, setFollowUps] = useState<FollowUp[] | null>(null);
  const [missed, setMissed] = useState<MissedPromise[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const mine = who === 'me' ? '&assigned_to=me' : '';
      const [overdue, today, broken] = await Promise.all([
        apiFetch(`/api/v1/collections/follow-ups?status=open&window=overdue&limit=100${mine}`),
        apiFetch(`/api/v1/collections/follow-ups?status=open&window=today&limit=100${mine}`),
        apiFetch('/api/v1/collections/promises?status=broken&limit=100'),
      ]);
      for (const r of [overdue, today, broken]) if (!r.ok) throw new Error(await readError(r));
      setFollowUps([...(await overdue.json()).items, ...(await today.json()).items]);
      setMissed((await broken.json()).items);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load follow-ups'); }
  }, [who]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  async function done(id: string) {
    const note = window.prompt('What happened?');
    if (note === null) return;
    const r = await apiFetch(`/api/v1/collections/follow-ups/${id}/close`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey('follow-up-close') },
      body: JSON.stringify({ outcome: 'done', note: note || undefined }),
    });
    if (!r.ok) { toast.error(await readError(r)); return; }
    void load();
  }

  const now = Date.now();
  return (
    <Card>
      <CardHeader className="gap-3">
        <div>
          <CardTitle>Follow-through</CardTitle>
          <CardDescription>Follow-ups due today or overdue, and promises to pay that were missed.</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="follow_ups">Follow-ups due{followUps ? ` (${followUps.length})` : ''}</TabsTrigger>
              <TabsTrigger value="missed">Missed promises{missed ? ` (${missed.length})` : ''}</TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === 'follow_ups' && (
            <Select value={who} onValueChange={v => setWho(v as typeof who)}>
              <SelectTrigger className="w-40" aria-label="Whose follow-ups"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="me">Assigned to me</SelectItem><SelectItem value="all">Everyone&apos;s</SelectItem></SelectContent>
            </Select>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error ? <ErrorState message={error} onRetry={load} /> : tab === 'follow_ups' ? (
          !followUps ? <Skeleton className="h-24" /> : followUps.length === 0 ? <EmptyState message="No follow-ups due." /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Due</TableHead><TableHead>Customer</TableHead><TableHead>Task</TableHead><TableHead>About</TableHead><TableHead>Assigned</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>{followUps.map(f => {
                  const late = new Date(f.dueAt).getTime() < now;
                  return (
                    <TableRow key={f.id}>
                      <TableCell className="whitespace-nowrap">{new Date(f.dueAt).toLocaleString()}{late && <Badge variant="destructive" className="ml-2">Late</Badge>}</TableCell>
                      <TableCell><Link className="font-medium hover:underline" href={`/dashboard/collections/customers/${f.customer.id}`}>{f.customer.name}</Link></TableCell>
                      <TableCell>{FOLLOW_UP_LABELS[f.followUpType] ?? f.followUpType}{f.note && <div className="text-xs text-muted-foreground">{f.note}</div>}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{f.sale ? `${f.sale.referenceNo}${f.installment ? ` #${f.installment.installmentNo}` : ''}` : '—'}</TableCell>
                      <TableCell className="text-sm">{f.assignee?.name ?? '—'}</TableCell>
                      <TableCell className="text-right">{can('collection.manage.branch') && <Button size="sm" variant="outline" onClick={() => done(f.id)}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Done</Button>}</TableCell>
                    </TableRow>
                  );
                })}</TableBody>
              </Table>
            </div>
          )
        ) : (
          !missed ? <Skeleton className="h-24" /> : missed.length === 0 ? <EmptyState message="No missed promises." /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Promised by</TableHead><TableHead>Customer</TableHead><TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Promised</TableHead><TableHead className="text-right">Collected</TableHead><TableHead>Recorded by</TableHead></TableRow></TableHeader>
                <TableBody>{missed.map(p => (
                  <TableRow key={p.id}>
                    <TableCell>{p.promised_date}</TableCell>
                    <TableCell><Link className="font-medium hover:underline" href={`/dashboard/collections/customers/${p.customer_id}`}>{p.customer_name}</Link></TableCell>
                    <TableCell className="whitespace-nowrap">{p.reference_no}{p.installment_no ? ` #${p.installment_no}` : ''}</TableCell>
                    <TableCell className="text-right"><Taka value={p.promised_amount} /></TableCell>
                    <TableCell className="text-right"><Taka value={p.collected} /></TableCell>
                    <TableCell className="text-sm">{p.recorded_by_name}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}
