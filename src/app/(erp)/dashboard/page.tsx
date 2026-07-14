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
