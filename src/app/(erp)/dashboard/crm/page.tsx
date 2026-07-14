// src/app/(erp)/dashboard/crm/page.tsx
// CRM leads board with today's-actions filter.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Users, Plus, Calendar } from 'lucide-react';
import { toast } from 'sonner';

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
  const [todayOnly, setTodayOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', company_name: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/leads?${todayOnly ? 'today=true' : ''}`);
      const data = await res.json();
      setLeads(data.items ?? []);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, [todayOnly]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const idempotencyKey = `lead-${Date.now()}`;
    // Need a status_id — fetch the first active status for this company
    // For now, the API requires status_id; we'd need a /lead-statuses endpoint
    // Simplified: use a placeholder
    toast.info('Lead creation requires a status_id — use the API directly for now');
    setShowForm(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="h-6 w-6" /> CRM — Leads</h1>
          <p className="text-muted-foreground">Sales pipeline with today's actions.</p>
        </div>
        <div className="flex gap-2">
          <Button variant={todayOnly ? 'default' : 'outline'} onClick={() => setTodayOnly(!todayOnly)}>
            <Calendar className="h-4 w-4 mr-2" /> Today's Actions ({todayOnly ? leads.length : '...'})
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Leads ({leads.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : leads.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No leads {todayOnly ? 'with actions today' : 'yet'}.</div>
          ) : (
            <div className="space-y-2">
              {leads.map(l => (
                <div key={l.id} className="border rounded p-3 flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{l.name}</span>
                      {l.company_name && <span className="text-sm text-muted-foreground">({l.company_name})</span>}
                      <Badge variant={l.status.isWon ? 'default' : l.status.isLost ? 'destructive' : 'secondary'}>
                        {l.status.name}
                      </Badge>
                      {l.converted_customer_id && <Badge variant="outline">converted</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {l.phone && `📞 ${l.phone}`}
                      {l.email && ` ✉️ ${l.email}`}
                      {l.estimated_value && ` 💰 ৳ ${parseFloat(l.estimated_value).toFixed(0)}`}
                      {l.assignee && ` 👤 ${l.assignee.name}`}
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
