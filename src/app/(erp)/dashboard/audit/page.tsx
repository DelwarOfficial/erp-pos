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
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';
import { formatDateTime } from '@/lib/i18n/format';
import { apiFetch } from '@/lib/api/client';

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
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const load = useCallback(async (reset: boolean = false) => {
    if (reset) { setLoading(true); } else { setLoadingMore(true); }
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (filters.action) params.set('action', filters.action);
      if (filters.entity_type) params.set('entity_type', filters.entity_type);
      if (filters.user_id) params.set('user_id', filters.user_id);
      if (!reset && cursor) params.set('cursor', cursor);
      const res = await apiFetch(`/api/v1/audit-logs?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load audit logs');
      setItems(prev => reset ? data.items : [...prev, ...data.items]);
      setCursor(data.next_cursor);
      setHasMore(data.has_more);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filters, cursor]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    load(true);
  }, [filters]);

  return (
    <div className="min-w-0 space-y-6 pb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <BookOpen aria-hidden="true" className="h-6 w-6" /> Audit Log
        </h1>
        <p className="text-muted-foreground">
          Review recorded workspace changes, who made them, and the values before and after each change.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Filter activity</CardTitle><CardDescription>Use exact action codes, record types, or user IDs to narrow the results. Times are shown in Asia/Dhaka.</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="space-y-1.5">
            <Label htmlFor="action">Action</Label>
            <Input id="action" aria-describedby="audit-action-help" placeholder="e.g. product.create" value={filters.action}
              onChange={e => setFilters({ ...filters, action: e.target.value })} className="min-h-11" />
            <p id="audit-action-help" className="text-xs leading-5 text-muted-foreground">Action code, such as product.create.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entity">Entity Type</Label>
            <Input id="entity" aria-describedby="audit-entity-help" placeholder="e.g. product" value={filters.entity_type}
              onChange={e => setFilters({ ...filters, entity_type: e.target.value })} className="min-h-11" />
          <p id="audit-entity-help" className="text-xs leading-5 text-muted-foreground">Record type, such as product or customer.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user">User ID</Label>
            <Input id="user" aria-describedby="audit-user-help" placeholder="Paste a user ID" value={filters.user_id}
              onChange={e => setFilters({ ...filters, user_id: e.target.value })} className="min-h-11" />
          <p id="audit-user-help" className="text-xs leading-5 text-muted-foreground">Use the user ID rather than a name or email.</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Entries ({items.length})</CardTitle>
              <CardDescription>Most recent first. Select an entry to inspect its details.</CardDescription>
            </div>
            {!loading && !error && <Button size="sm" variant="ghost" onClick={() => load(true)}>Refresh</Button>}
          </CardHeader>
          <CardContent className="space-y-1">
            {loading ? (
              <LoadingState label="Loading audit entries…" />
            ) : error ? (
              <ErrorState message={error} onRetry={() => load(true)} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<BookOpen aria-hidden="true" className="h-8 w-8 text-muted-foreground/50" />}
                message="No audit entries in the last 30 days."
              />
            ) : (
              <>
                <div className="max-h-[65vh] space-y-3 overflow-y-auto p-1">
                  {items.map(l => (
                    <button
                      key={l.id}
                      aria-pressed={selected?.id === l.id}
                      onClick={() => setSelected(l)}
                      className={`w-full min-w-0 rounded-lg border p-4 text-left hover:bg-muted transition-colors motion-reduce:transition-none min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                        selected?.id === l.id ? 'bg-primary/5 border-primary/50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="break-all text-sm font-mono">{l.action}</code>
                        <Badge variant="outline" className="text-xs">{l.entity_type}</Badge>
                      </div>
                      <div className="mt-2 break-words text-xs leading-5 text-muted-foreground">
                        {l.user?.email ?? 'system'} • {formatDateTime(l.occurred_at)} • {l.client_ip ?? 'no IP'}
                      </div>
                    </button>
                  ))}
                </div>
                {hasMore && (
                  <Button variant="outline" className="w-full min-h-[44px] mt-2" onClick={() => load(false)} disabled={loadingMore}>
                    {loadingMore ? <Loader2 aria-hidden="true" className="h-4 w-4 mr-2 animate-spin motion-reduce:animate-none" /> : null}
                    {loadingMore ? 'Loading more...' : 'Load more'}
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activity details</CardTitle>
            <CardDescription>Selected entry&rsquo;s before/after values.</CardDescription>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <EmptyState message="Select an entry to view details." />
            ) : (
              <div className="space-y-3 text-sm">
                <Row label="Action" value={selected.action} />
                <Row label="Entity" value={`${selected.entity_type} (${selected.entity_id.slice(0, 8)}...)`} />
                <Row label="User" value={selected.user?.email ?? 'system'} />
                <Row label="Device" value={selected.device?.label ?? '—'} />
                <Row label="Correlation" value={<code className="text-xs break-all">{selected.correlation_id}</code>} />
                <Row label="IP" value={selected.client_ip ?? '—'} />
                <Row label="Time" value={formatDateTime(selected.occurred_at)} />
                {selected.before_value !== null && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Before</Label>
                    <pre className="text-xs p-2 bg-muted rounded font-mono overflow-x-auto max-h-40">
                      {JSON.stringify(selected.before_value, null, 2)}
                    </pre>
                  </div>
                )}
                {selected.after_value !== null && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">After</Label>
                    <pre className="text-xs p-2 bg-muted rounded font-mono overflow-x-auto max-h-40">
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
    <div className="flex min-w-0 flex-col gap-1 border-b py-2 last:border-0 sm:flex-row sm:justify-between sm:gap-3">
      <span className="text-muted-foreground flex-shrink-0">{label}</span>
      <span className="min-w-0 break-all font-medium sm:text-right">{value}</span>
    </div>
  );
}
