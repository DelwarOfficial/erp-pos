// src/app/(erp)/dashboard/crm/page.tsx
// CRM leads board with today's-actions filter.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Users, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';

interface Lead {
  id: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  estimated_value: string | null;
  next_action_at: string | null;
  notes: string | null;
  status: { name: string; isWon: boolean; isLost: boolean; position: number };
  assignee: { name: string } | null;
  converted_customer_id: string | null;
}

export default function CRMPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [todayOnly, setTodayOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/leads?${todayOnly ? 'today=true' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load leads');
      setLeads(data.items ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [todayOnly]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="h-6 w-6" /> CRM — Leads</h1>
          <p className="text-muted-foreground">Sales pipeline with today&rsquo;s actions.</p>
        </div>
        <div className="flex gap-2">
          <Button variant={todayOnly ? 'default' : 'outline'} onClick={() => setTodayOnly(!todayOnly)} className="min-h-[44px]">
            <Calendar className="h-4 w-4 mr-2" /> Today&rsquo;s Actions ({todayOnly ? leads.length : '…'})
          </Button>
          {!loading && !error && <Button size="sm" variant="ghost" onClick={load}>Refresh</Button>}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Leads ({leads.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingState label="Loading leads…" />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
          ) : leads.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8 text-muted-foreground/50" />}
              message={<>No leads {todayOnly ? 'with actions today' : 'yet'}.</>}
            />
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {leads.map(l => (
                <div key={l.id} className="border rounded p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{l.name}</span>
                      {l.company_name && <span className="text-sm text-muted-foreground">({l.company_name})</span>}
                      <Badge variant={l.status.isWon ? 'default' : l.status.isLost ? 'destructive' : 'secondary'}>
                        {l.status.name}
                      </Badge>
                      {l.converted_customer_id && <Badge variant="outline">converted</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {l.phone && <span>📞 {l.phone}</span>}
                      {l.email && <span>✉️ {l.email}</span>}
                      {l.estimated_value && <span>💰 ৳ {parseFloat(l.estimated_value).toFixed(0)}</span>}
                      {l.assignee && <span>👤 {l.assignee.name}</span>}
                    </div>
                    {l.next_action_at && (
                      <div className="text-xs text-amber-600 mt-1">
                        ⏰ Next action: {new Date(l.next_action_at).toLocaleString()}
                      </div>
                    )}
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
