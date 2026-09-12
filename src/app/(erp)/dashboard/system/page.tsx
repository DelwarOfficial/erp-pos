'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboardSession } from '@/components/dashboard/session';
import { checkLabel, parseHealth, type HealthResponse } from '@/lib/health/contract';

export default function SystemPage() {
  const user = useDashboardSession();
  const allowed = Boolean(user && (user.is_global || user.permissions.includes('system.config.view')));
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch('/api/v1/admin/health', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
        if (response.status === 401 || response.status === 403) throw new Error('System Health access denied.');
        if (!response.ok && response.status !== 503) throw new Error('Health API unavailable. Dependency status is unknown.');
        const data = parseHealth(await response.json());
        if (!data || (response.status === 503 && data.status === 'ok')) throw new Error('Unknown or malformed health response. Dependency status is unknown.');
        if (!cancelled) { setHealth(data); setFailure(null); }
      } catch (error) {
        if (!cancelled) {
          setHealth(null);
          setFailure(error instanceof Error && ['System Health access denied.', 'Unknown or malformed health response. Dependency status is unknown.'].includes(error.message)
            ? error.message : 'Health API unavailable. Dependency status is unknown.');
        }
      } finally { if (!cancelled) timer = setTimeout(refresh, 10000); }
    }
    void refresh();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [allowed]);
  if (!allowed) return <div><h1 className="text-2xl font-bold">System Health</h1><p role="alert">System Health access denied.</p></div>;
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">System Health</h1><p className="text-muted-foreground">Current service checks. Updates every 10 seconds.</p></div>
    {failure && <p role="alert">{failure}</p>}
    {!health && !failure && <p role="status">Checking service health…</p>}
    {health && <>
      <Card><CardHeader><CardTitle>Application status</CardTitle></CardHeader><CardContent>
        <p className="text-xl">{health.status === 'ok' ? 'Healthy' : health.status === 'degraded' ? 'Degraded' : 'Unavailable'}</p>
        <p>Database and Redis are required. Storage is optional.</p>
        <p>Response time: {health.response_ms} ms</p>
        <p>Checked: <time dateTime={health.timestamp}>{new Date(health.timestamp).toLocaleString()}</time></p>
        {health.version && <p>Version: {health.version}</p>}
      </CardContent></Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(['database', 'redis', 'storage', 'worker'] as const).map(key =>
          <Card key={key}><CardHeader><CardTitle>{({ database: 'Database', redis: 'Redis', storage: 'Storage', worker: 'Queue workers' })[key]}</CardTitle></CardHeader>
            <CardContent><p>{checkLabel(health.checks[key] ?? 'skipped')}</p>
              {key !== 'worker' && health.details[key] && <p>{health.details[key]!.response_ms} ms</p>}
            </CardContent></Card>)}
      </div>
    </>}
  </div>;
}
