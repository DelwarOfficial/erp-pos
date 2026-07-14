// src/app/(erp)/dashboard/audit/page.tsx
// Audit log browser — list with filters.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { BookOpen, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  user: { id: string; name: string; email: string } | null;
  device: { id: string; label: string } | null;
  correlation_id: string;
  before_value: unknown;
  after_value: unknown;
  client_ip: string | null;
  user_agent: string | null;
  occurred_at: string;
}

export default function AuditPage() {
  const [items, setItems] = useState<AuditLog[]>([]);
  const [filters, setFilters] = useState({ action: '', entity_type: '', user_id: '' });
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const load = useCallback(async (reset: boolean = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (filters.action) params.set('action', filters.action);
      if (filters.entity_type) params.set('entity_type', filters.entity_type);
      if (filters.user_id) params.set('user_id', filters.user_id);
      if (!reset && cursor) params.set('cursor', cursor);
      const res = await fetch(`/api/v1/audit-logs?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed');
      setItems(prev => reset ? data.items : [...prev, ...data.items]);
      setCursor(data.next_cursor);
      setHasMore(data.has_more);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [filters, cursor]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    load(true);
  }, [filters]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BookOpen className="h-6 w-6" /> Audit Log
        </h1>
        <p className="text-muted-foreground">
          Append-only record of every mutation. Before/after values, actor, IP, correlation ID.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="action">Action</Label>
            <Input id="action" placeholder="e.g. product.create" value={filters.action}
              onChange={e => setFilters({ ...filters, action: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="entity">Entity Type</Label>
            <Input id="entity" placeholder="e.g. product" value={filters.entity_type}
              onChange={e => setFilters({ ...filters, entity_type: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="user">User ID</Label>
            <Input id="user" placeholder="UUID" value={filters.user_id}
              onChange={e => setFilters({ ...filters, user_id: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Entries ({items.length})</CardTitle>
            <CardDescription>Most recent first. Click to inspect.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {items.length === 0 && !loading ? (
              <div className="text-center py-8 text-muted-foreground">No audit entries.</div>
            ) : (
              items.map(l => (
                <button
                  key={l.id}
                  onClick={() => setSelected(l)}
                  className={`w-full text-left p-2 border rounded hover:bg-slate-50 transition-colors ${
                    selected?.id === l.id ? 'bg-slate-100 border-slate-400' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono">{l.action}</code>
                    <Badge variant="outline" className="text-xs">{l.entity_type}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {l.user?.email ?? 'system'} • {new Date(l.occurred_at).toLocaleString()} • {l.client_ip ?? 'no IP'}
                  </div>
                </button>
              ))
            )}
            {hasMore && (
              <Button variant="outline" className="w-full" onClick={() => load(false)} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Load more
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Detail</CardTitle>
            <CardDescription>Selected entry's before/after values.</CardDescription>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Select an entry to view details.</div>
            ) : (
              <div className="space-y-3 text-sm">
                <Row label="Action" value={selected.action} />
                <Row label="Entity" value={`${selected.entity_type} (${selected.entity_id.slice(0, 8)}...)`} />
                <Row label="User" value={selected.user?.email ?? 'system'} />
                <Row label="Device" value={selected.device?.label ?? '—'} />
                <Row label="Correlation" value={<code className="text-xs break-all">{selected.correlation_id}</code>} />
                <Row label="IP" value={selected.client_ip ?? '—'} />
                <Row label="Time" value={new Date(selected.occurred_at).toLocaleString()} />
                {selected.before_value !== null && (
                  <div>
                    <Label className="text-xs">Before</Label>
                    <pre className="text-xs mt-1 p-2 bg-slate-50 rounded font-mono overflow-x-auto max-h-40">
                      {JSON.stringify(selected.before_value, null, 2)}
                    </pre>
                  </div>
                )}
                {selected.after_value !== null && (
                  <div>
                    <Label className="text-xs">After</Label>
                    <pre className="text-xs mt-1 p-2 bg-slate-50 rounded font-mono overflow-x-auto max-h-40">
                      {JSON.stringify(selected.after_value, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground flex-shrink-0">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}
