// src/app/(erp)/dashboard/security/page.tsx
// Security events viewer — list with severity filter.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ShieldAlert, Loader2, AlertCircle, AlertTriangle, Info, ShieldX } from 'lucide-react';
import { toast } from 'sonner';

interface SecurityEvent {
  id: string;
  event_type: string;
  severity: 'info' | 'warning' | 'high' | 'critical';
  user: { id: string; name: string; email: string } | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

const SEVERITY_CONFIG = {
  critical: { icon: ShieldX, color: 'text-red-600', bg: 'bg-red-50', badge: 'destructive' },
  high: { icon: AlertCircle, color: 'text-orange-600', bg: 'bg-orange-50', badge: 'destructive' },
  warning: { icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-50', badge: 'secondary' },
  info: { icon: Info, color: 'text-blue-600', bg: 'bg-blue-50', badge: 'outline' },
};

export default function SecurityPage() {
  const [items, setItems] = useState<SecurityEvent[]>([]);
  const [severity, setSeverity] = useState<string>('all');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (reset: boolean = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (severity !== 'all') params.set('severity', severity);
      if (!reset && cursor) params.set('cursor', cursor);
      const res = await fetch(`/api/v1/security-events?${params}`);
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
  }, [severity, cursor]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    load(true);
  }, [severity]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldAlert className="h-6 w-6" /> Security Events
        </h1>
        <p className="text-muted-foreground">
          Authentication failures, idempotency conflicts, refresh-token reuse, MFA events, WebAuthn activity.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Events ({items.length})</CardTitle>
          <CardDescription>Most recent first. Click an event to view metadata.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.length === 0 && !loading ? (
            <div className="text-center py-8 text-muted-foreground">No security events.</div>
          ) : (
            items.map(e => {
              const config = SEVERITY_CONFIG[e.severity];
              const Icon = config.icon;
              return (
                <div key={e.id} className={`flex items-start gap-3 p-3 border rounded-md ${config.bg}`}>
                  <Icon className={`h-5 w-5 ${config.color} mt-0.5 flex-shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-sm font-mono font-medium">{e.event_type}</code>
                      <Badge variant={config.badge as any}>{e.severity}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(e.occurred_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {e.user ? `${e.user.email}` : 'system'}
                      {e.ip_address && ` • IP: ${e.ip_address}`}
                    </div>
                    {Object.keys(e.metadata).length > 0 && (
                      <pre className="text-xs mt-2 p-2 bg-white/50 rounded font-mono overflow-x-auto">
                        {JSON.stringify(e.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {hasMore && (
            <Button variant="outline" className="w-full" onClick={() => load(false)} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Load more
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
