# Historical dashboard engineering notes

Moved out of operational UI on 2026-09-12. These are historical planning/checklist snapshots, not verified runtime status or completion evidence. Current implementation and remediation evidence take precedence (notably MariaDB, not PostgreSQL RLS).

## src/app/(erp)/dashboard/page.tsx

```tsx
// src/app/(erp)/dashboard/page.tsx
// Dashboard overview — Phase M0 status card.

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle, Clock } from 'lucide-react';

const MILESTONES = [
  { id: 'M0', name: 'Architecture Foundation', status: 'in_progress', items: [
    'Prisma schema for §5.1, §5.2, §5.3, §5.15',
    'Request-scoped transaction wrapper (RLS-equivalent)',
    'Argon2id + JWT 15min + rotating refresh tokens',
    'TOTP MFA + progressive lockout',
    'Idempotency-Key middleware',
    'Audit logger + security events',
    'next_document_number() helper',
    'Permission catalogue (60+ permissions)',
    'System roles (owner, global_admin, branch_manager, cashier, accountant, etc.)',
    'Platform onboarding API (§20.D01)',
  ]},
  { id: 'M1', name: 'Organization and Catalogue', status: 'pending' },
  { id: 'M2', name: 'Inventory and Purchasing', status: 'pending' },
  { id: 'M3', name: 'POS and Payments', status: 'pending' },
  { id: 'M4', name: 'Accounting and Compliance', status: 'pending' },
  { id: 'M5', name: 'Delivery and Service', status: 'pending' },
  { id: 'M6', name: 'CRM, Communications, and HR', status: 'pending' },
  { id: 'M7', name: 'Offline and Integrations', status: 'pending' },
  { id: 'M8', name: 'Hardening and Go-Live', status: 'pending' },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ERP/POS — Multi-tenant ERP System</h1>
        <p className="text-muted-foreground">
          Bangladesh electronics/mobile/appliance retail + service + warranty ERP. Phase M0 (Foundation) is operational.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Current Phase</CardDescription>
            <CardTitle className="text-2xl">M0 — Foundation</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary" className="gap-1">
              <Clock className="h-3 w-3" /> In Progress
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Milestones</CardDescription>
            <CardTitle className="text-2xl">9</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">M0 → M8</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Domain Commands</CardDescription>
            <CardTitle className="text-2xl">0 / 37</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">M3 onward</Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Phased Development Plan</CardTitle>
          <CardDescription>Per §18A.1 milestone order — execute in sequence, no skipping.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {MILESTONES.map(m => (
            <div key={m.id} className="flex items-start gap-3 pb-3 border-b last:border-b-0 last:pb-0">
              {m.status === 'in_progress' ? (
                <Clock className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
              ) : m.status === 'completed' ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1">
                <div className="font-medium">
                  <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded mr-2">{m.id}</code>
                  {m.name}
                </div>
                {m.items && (
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {m.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="h-3 w-3 text-green-500 mt-1 flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

## src/app/(erp)/dashboard/system/page.tsx

```tsx
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
```

