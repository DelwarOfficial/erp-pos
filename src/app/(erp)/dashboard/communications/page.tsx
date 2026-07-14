// src/app/(erp)/dashboard/communications/page.tsx
// Communications hub — notifications inbox, templates, campaigns.
// Consumes: GET /api/v1/notifications, GET /api/v1/translations

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, MessageSquare, Bell, FileText, Megaphone, RefreshCw, CheckCheck, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';

interface Notification {
  id: string;
  notification_type: string;
  severity: string;
  title: string;
  body: string;
  action_url: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
}

interface TranslationPayload {
  locale: string;
  fallback_locale: string;
  translations: Record<string, string>;
  override_count: number;
}

function severityBadgeVariant(severity: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (severity) {
    case 'critical': return 'destructive';
    case 'high': return 'default';
    case 'warning': return 'secondary';
    default: return 'outline';
  }
}

export default function CommunicationsPage() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="h-6 w-6" /> Communications
        </h1>
        <p className="text-muted-foreground">
          Notification inbox, message templates, and campaign management.
        </p>
      </div>

      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox" className="min-h-[40px]">
            <Bell className="h-3 w-3 mr-1" /> Inbox
          </TabsTrigger>
          <TabsTrigger value="templates" className="min-h-[40px]">
            <FileText className="h-3 w-3 mr-1" /> Templates
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="min-h-[40px]">
            <Megaphone className="h-3 w-3 mr-1" /> Campaigns
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="space-y-4">
          <InboxTab />
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          <TemplatesTab />
        </TabsContent>

        <TabsContent value="campaigns" className="space-y-4">
          <CampaignsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InboxTab() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/notifications?limit=100');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load notifications');
      setNotifications(data.items ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const types = useMemo(() => {
    const set = new Set<string>();
    notifications.forEach(n => set.add(n.notification_type));
    return Array.from(set).sort();
  }, [notifications]);

  const filtered = useMemo(() => {
    return notifications.filter(n => {
      if (typeFilter !== 'all' && n.notification_type !== typeFilter) return false;
      if (search && !`${n.title} ${n.body}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [notifications, typeFilter, search]);

  async function handleMarkRead(id: string) {
    setMarkingId(id);
    try {
      const idempotencyKey = `notif-read-${id}-${Date.now()}`;
      const res = await fetch(`/api/v1/notifications/${id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error?.message ?? `Mark-as-read failed (HTTP ${res.status}). Server may not expose this endpoint yet.`);
        return;
      }
      setReadIds(prev => new Set(prev).add(id));
      toast.success('Marked as read');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setMarkingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <CardTitle className="text-base">Notification Inbox ({filtered.length})</CardTitle>
          <CardDescription>Recent system and operational notifications for your company.</CardDescription>
        </div>
        {!loading && !error && (
          <Button size="sm" variant="ghost" onClick={load} className="min-h-[40px]">
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <Input
            placeholder="Search by title or body..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="sm:max-w-xs min-h-[40px]"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={typeFilter === 'all' ? 'default' : 'outline'}
              onClick={() => setTypeFilter('all')}
              className="min-h-[36px]"
            >
              All ({notifications.length})
            </Button>
            {types.map(t => (
              <Button
                key={t}
                size="sm"
                variant={typeFilter === t ? 'default' : 'outline'}
                onClick={() => setTypeFilter(t)}
                className="min-h-[36px]"
              >
                {t}
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <LoadingState label="Loading notifications..." />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Bell className="h-8 w-8 text-muted-foreground/50" />}
            message="No notifications match the current filter."
          />
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {filtered.map(n => {
              const isRead = readIds.has(n.id);
              return (
                <div
                  key={n.id}
                  className={`border rounded p-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2 ${isRead ? 'opacity-60' : ''}`}
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={severityBadgeVariant(n.severity)}>{n.severity}</Badge>
                      <Badge variant="outline">{n.notification_type}</Badge>
                      {isRead && <Badge variant="secondary">read</Badge>}
                      <span className="font-medium text-sm">{n.title}</span>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{n.body}</p>
                    <div className="text-xs text-muted-foreground">
                      {new Date(n.created_at).toLocaleString()}
                      {n.entity_type && <span className="ml-2">| {n.entity_type}: {n.entity_id?.slice(0, 8)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {n.action_url && (
                      <a
                        href={n.action_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1 min-h-[36px] px-2"
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleMarkRead(n.id)}
                      disabled={markingId === n.id || isRead}
                      className="min-h-[36px]"
                    >
                      {markingId === n.id
                        ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        : <CheckCheck className="h-3 w-3 mr-1" />}
                      Mark read
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TemplatesTab() {
  const [data, setData] = useState<TranslationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/translations?locale=en-BD');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to load templates');
      setData(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const entries = useMemo(() => {
    if (!data?.translations) return [];
    return Object.entries(data.translations)
      .filter(([k, v]) => !search || k.toLowerCase().includes(search.toLowerCase()) || String(v).toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [data, search]);

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <CardTitle className="text-base">Communication Templates</CardTitle>
          <CardDescription>
            Translation keys exposed via /api/v1/translations. Locale: {data?.locale ?? 'en-BD'}
            {data?.override_count ? ` - ${data.override_count} company overrides` : ''}
          </CardDescription>
        </div>
        {!loading && !error && (
          <Button size="sm" variant="ghost" onClick={load} className="min-h-[40px]">
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          placeholder="Search translation keys or values..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="sm:max-w-md min-h-[40px]"
        />
        {loading ? (
          <LoadingState label="Loading templates..." />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-8 w-8 text-muted-foreground/50" />}
            message="No translation keys match the search."
          />
        ) : (
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{k}</TableCell>
                    <TableCell className="text-sm">{String(v)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CampaignsTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Campaigns</CardTitle>
        <CardDescription>
          Marketing and transactional campaigns. A campaigns API is not yet wired up - this is a placeholder.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EmptyState
          icon={<Megaphone className="h-8 w-8 text-muted-foreground/50" />}
          message="No campaigns API is available yet. Once /api/v1/campaigns is implemented, campaign records will appear here."
        />
      </CardContent>
    </Card>
  );
}
