// src/app/(erp)/dashboard/collections/page.tsx
// Collection control centre: who owes what, when, and what happens next.
// Consumes: GET /api/v1/collections/overview, GET /api/v1/collections/worklist,
//           GET|POST /api/v1/collections/installments/{id}/reminder (via ReminderDialog),
//           follow-ups and missed promises (via FollowUpQueue).
// Every figure comes from the server; nothing is computed here.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, CircleDollarSign, HandCoins, MessageSquare, PhoneOff, RefreshCw, Search, Send, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, EmptyState } from '@/components/shared/StateList';
import { apiFetch } from '@/lib/api/client';
import { PhoneStatus, readError, SmsStatusBadge, Taka, useCan } from '@/components/collections/common';
import { ReminderDialog } from '@/components/collections/ReminderDialog';
import { FollowUpQueue } from '@/components/collections/FollowUpQueue';

interface Overview {
  as_of: string; ledger_receivable: string | null; scheduled_outstanding: string;
  due_today: { installments: number; amount: string };
  overdue: { installments: number; customers: number; amount: string };
  upcoming_7_days: { installments: number; amount: string };
  collected_today: string;
  customers_without_valid_phone: { missing: number; invalid: number };
  sms_today: { queued: number; sent: number; delivered: number; failed: number; unknown: number; skipped: number };
  sms_needing_attention_7_days: { unknown: number; failed: number; dead_letter: number };
}

interface Row {
  installment_id: string; sale_id: string; invoice_no: string; installment_no: number;
  customer: { id: string; name: string }; phone_masked: string | null; phone_status: string; salesperson: string | null;
  due_date: string; amount: string; collected: string; outstanding: string; days_overdue: number;
  last_payment_at: string | null; last_sms: { status: string; at: string } | null;
}

type View = 'due_today' | 'overdue' | 'upcoming' | 'all_open';

function Kpi({ title, icon: Icon, value, detail, onClick, tone }: {
  title: string; icon: React.ComponentType<{ className?: string }>; value: React.ReactNode; detail?: React.ReactNode; onClick?: () => void; tone?: 'danger';
}) {
  const body = (
    <Card className={`h-full ${onClick ? 'transition-colors hover:bg-muted/50' : ''}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${tone === 'danger' ? 'text-destructive' : 'text-muted-foreground'}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold ${tone === 'danger' ? 'text-destructive' : ''}`}>{value}</div>
        {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      </CardContent>
    </Card>
  );
  return onClick ? <button type="button" className="text-left" onClick={onClick}>{body}</button> : body;
}

export default function CollectionsPage() {
  const can = useCan();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [view, setView] = useState<View>('due_today');
  const [days, setDays] = useState('7');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [remindFor, setRemindFor] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setOverviewError(null);
    try {
      const r = await apiFetch('/api/v1/collections/overview');
      if (!r.ok) throw new Error(await readError(r));
      setOverview(await r.json());
    } catch (e) { setOverviewError(e instanceof Error ? e.message : 'Could not load the overview'); }
  }, []);

  const loadRows = useCallback(async (after: string | null) => {
    const params = new URLSearchParams({ view, limit: '50' });
    if (view === 'upcoming') params.set('days', days);
    if (search) params.set('q', search);
    if (after) params.set('cursor', after);
    if (after) setLoadingMore(true); else { setLoading(true); setListError(null); }
    try {
      const r = await apiFetch(`/api/v1/collections/worklist?${params}`);
      if (!r.ok) throw new Error(await readError(r));
      const data = await r.json();
      setRows(prev => (after ? [...prev, ...data.items] : data.items));
      setCursor(data.next_cursor);
    } catch (e) { setListError(e instanceof Error ? e.message : 'Could not load the worklist'); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [view, days, search]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadRows(null); }, [loadRows]);

  const refresh = () => { void loadOverview(); void loadRows(null); };
  const attention = overview ? overview.sms_needing_attention_7_days.unknown + overview.sms_needing_attention_7_days.failed + overview.sms_needing_attention_7_days.dead_letter : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Collections</h1>
          <p className="text-sm text-muted-foreground">Who owes money, how much, when it is due, and what to do next.{overview ? ` As of ${overview.as_of}.` : ''}</p>
        </div>
        <div className="flex gap-2">
          {can('sale.post') && <Button variant="outline" asChild><Link href="/dashboard/sales/credit"><CalendarClock className="mr-2 h-4 w-4" />New credit sale</Link></Button>}
          <Button variant="outline" onClick={refresh}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
        </div>
      </div>

      {overviewError ? <ErrorState message={overviewError} onRetry={loadOverview} /> : !overview ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <>
          {attention > 0 && (
            <Card className="border-destructive/50">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span>
                    In the last 7 days: {overview.sms_needing_attention_7_days.unknown} SMS with an unknown outcome, {overview.sms_needing_attention_7_days.failed + overview.sms_needing_attention_7_days.dead_letter} failed.
                  </span>
                </div>
                <Button size="sm" variant="outline" asChild><Link href="/dashboard/communications/sms?tab=history&status=unknown">Review</Link></Button>
              </CardContent>
            </Card>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi title="Due today" icon={CalendarClock} value={<Taka value={overview.due_today.amount} />} detail={`${overview.due_today.installments} installments`} onClick={() => setView('due_today')} />
            <Kpi title="Overdue" icon={AlertTriangle} tone={overview.overdue.installments ? 'danger' : undefined} value={<Taka value={overview.overdue.amount} />}
              detail={`${overview.overdue.customers} customers · ${overview.overdue.installments} installments`} onClick={() => setView('overdue')} />
            <Kpi title="Next 7 days" icon={CircleDollarSign} value={<Taka value={overview.upcoming_7_days.amount} />} detail={`${overview.upcoming_7_days.installments} installments`}
              onClick={() => { setView('upcoming'); setDays('7'); }} />
            <Kpi title="Collected today" icon={HandCoins} value={<Taka value={overview.collected_today} />} detail="Against installments" />
            <Kpi title="Receivable (ledger)" icon={Users} value={<Taka value={overview.ledger_receivable} />} detail={<>Scheduled still to collect: <Taka value={overview.scheduled_outstanding} /></>} />
            <Kpi title="SMS today" icon={MessageSquare} value={`${overview.sms_today.sent + overview.sms_today.delivered}`}
              detail={`${overview.sms_today.delivered} delivered · ${overview.sms_today.queued} waiting · ${overview.sms_today.failed} failed · ${overview.sms_today.unknown} unknown`} />
            <Kpi title="No usable mobile" icon={PhoneOff} tone={overview.customers_without_valid_phone.missing + overview.customers_without_valid_phone.invalid ? 'danger' : undefined}
              value={`${overview.customers_without_valid_phone.missing + overview.customers_without_valid_phone.invalid}`}
              detail={`${overview.customers_without_valid_phone.missing} missing · ${overview.customers_without_valid_phone.invalid} invalid — owing customers who cannot be reminded`} />
          </div>
        </>
      )}

      <Card>
        <CardHeader className="gap-4">
          <div>
            <CardTitle>Worklist</CardTitle>
            <CardDescription>Oldest due first. Amounts are what is still owed now.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={view} onValueChange={v => setView(v as View)}>
              <TabsList>
                <TabsTrigger value="due_today">Due today</TabsTrigger>
                <TabsTrigger value="overdue">Overdue</TabsTrigger>
                <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                <TabsTrigger value="all_open">All open</TabsTrigger>
              </TabsList>
            </Tabs>
            {view === 'upcoming' && (
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger className="w-36" aria-label="Upcoming window"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1">Tomorrow</SelectItem><SelectItem value="7">Next 7 days</SelectItem><SelectItem value="30">Next 30 days</SelectItem></SelectContent>
              </Select>
            )}
            <form className="flex flex-1 items-center gap-2 sm:max-w-sm" onSubmit={e => { e.preventDefault(); setSearch(query.trim()); }}>
              <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Customer, invoice or mobile" aria-label="Search the worklist" />
              <Button type="submit" variant="outline" size="icon" aria-label="Search"><Search className="h-4 w-4" /></Button>
            </form>
          </div>
        </CardHeader>
        <CardContent>
          {listError ? <ErrorState message={listError} onRetry={() => loadRows(null)} /> : loading ? (
            <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : rows.length === 0 ? (
            <EmptyState message={search ? 'Nothing matches that search.' : view === 'due_today' ? 'Nothing falls due today.' : view === 'overdue' ? 'No overdue installments.' : 'No open installments here.'} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead><TableHead>Mobile</TableHead><TableHead>Invoice</TableHead><TableHead>Due</TableHead>
                    <TableHead className="text-right">Owed</TableHead><TableHead>Last payment</TableHead><TableHead>Last SMS</TableHead>
                    <TableHead>Salesperson</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.installment_id}>
                      <TableCell><Link className="font-medium hover:underline" href={`/dashboard/collections/customers/${r.customer.id}`}>{r.customer.name}</Link></TableCell>
                      <TableCell><PhoneStatus masked={r.phone_masked} status={r.phone_status} /></TableCell>
                      <TableCell className="whitespace-nowrap">{r.invoice_no} <span className="text-muted-foreground">#{r.installment_no}</span></TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.due_date}
                        {r.days_overdue > 0 && <Badge variant="destructive" className="ml-2">{r.days_overdue}d late</Badge>}
                      </TableCell>
                      <TableCell className="text-right"><Taka value={r.outstanding} />{r.collected !== '0.00' && <div className="text-xs text-muted-foreground">of <Taka value={r.amount} /></div>}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{r.last_payment_at ? r.last_payment_at.slice(0, 10) : '—'}</TableCell>
                      <TableCell>{r.last_sms ? <SmsStatusBadge status={r.last_sms.status} /> : <span className="text-sm text-muted-foreground">None</span>}</TableCell>
                      <TableCell className="text-sm">{r.salesperson ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setRemindFor(r.installment_id)} disabled={r.phone_status !== 'ok'}
                            title={r.phone_status !== 'ok' ? 'No usable mobile number' : 'Preview and send a reminder'}>
                            <Send className="mr-1 h-3.5 w-3.5" />Remind
                          </Button>
                          {can('payment.pay.branch') && (
                            <Button size="sm" asChild><Link href={`/dashboard/collections/customers/${r.customer.id}#collect`}>Collect</Link></Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {cursor && (
                <div className="mt-4 flex justify-center">
                  <Button variant="outline" onClick={() => loadRows(cursor)} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <FollowUpQueue />

      <ReminderDialog installmentId={remindFor} open={remindFor !== null} onOpenChange={open => { if (!open) setRemindFor(null); }} onSent={refresh} />
    </div>
  );
}
