// src/app/(erp)/dashboard/system/page.tsx
// System health check.

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Server, Database, Activity } from 'lucide-react';

interface HealthResponse {
  status: string;
  service: string;
  phase: string;
  version: string;
  db: string;
  response_ms: number;
  timestamp: string;
}

export default function SystemPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetch('/api/v1/health').then(r => r.json()).then(setHealth).catch(console.error);
    const id = setInterval(() => {
      fetch('/api/v1/health').then(r => r.json()).then(setHealth).catch(console.error);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Server className="h-6 w-6" /> System Health
        </h1>
        <p className="text-muted-foreground">Live health check polling every 5 seconds.</p>
      </div>

      {health && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Activity className="h-3 w-3" /> Service Status
              </CardDescription>
              <CardTitle className="text-2xl capitalize">{health.status}</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={health.status === 'ok' ? 'default' : 'destructive'}>
                {health.service} v{health.version}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Database className="h-3 w-3" /> Database
              </CardDescription>
              <CardTitle className="text-2xl capitalize">{health.db}</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={health.db === 'reachable' ? 'default' : 'destructive'}>
                {health.db === 'reachable' ? 'Connected' : 'Unreachable'}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Response Time</CardDescription>
              <CardTitle className="text-2xl">{health.response_ms}ms</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant="outline">Phase {health.phase}</Badge>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Architecture Controls (§20.0)</CardTitle>
          <CardDescription>13 non-negotiable controls. All enabled by default.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {[
            'Tenant isolation via RLS / set_config() context',
            'Idempotency-Key required on every mutation',
            'Argon2id password hashing (memory≥64MB, time≥3)',
            'JWT 15min HttpOnly+Secure+SameSite=Strict cookie',
            'Rotating refresh tokens with family revocation',
            'TOTP MFA for owners/admins/approvers',
            'Progressive lockout per IP/account/company/device',
            'Append-only audit logs (INSERT/SELECT only)',
            'Forward-only SQL migrations',
            'SECURITY DEFINER functions with safe search_path',
            'Maker-checker approval flow',
            'No cached balances replace authoritative ledgers',
            'External network calls never inside DB transactions',
          ].map((control, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-green-500">✓</span>
              <span>{control}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
