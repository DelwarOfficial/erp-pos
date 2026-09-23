'use client';

import Link from 'next/link';
import { ArrowUpRight, Building2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboardSession } from '@/components/dashboard/session';

const workflows = [
  { href: '/dashboard/pos', label: 'New sale', permission: 'sale.post' },
  { href: '/dashboard/inventory', label: 'Inventory', permission: 'inventory.read' },
  { href: '/dashboard/purchases', label: 'Purchases', permission: 'purchase.read' },
  { href: '/dashboard/reports', label: 'Reports', permission: 'report.execute' },
];

export default function DashboardPage() {
  const user = useDashboardSession();
  if (!user) return <p role="status">Session information unavailable.</p>;
  const platformWorkflows = [
    { href: '/dashboard/access/users', label: 'Manage users' },
    { href: '/dashboard/access/roles', label: 'Manage roles' },
    { href: '/dashboard/onboarding', label: 'Onboard tenant' },
    { href: '/dashboard/system', label: 'System Health' },
  ];
  const links = user.is_global ? platformWorkflows : workflows.filter(item => !user.is_global && user.permissions.includes(item.permission));
  const branches = (user.branches ?? []).filter(branch => user.branch_ids.includes(branch.id));
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Badge variant="outline" className="gap-1.5">{user.is_global ? <ShieldCheck className="size-3.5" aria-hidden="true" /> : <Building2 className="size-3.5" aria-hidden="true" />}{user.is_global ? 'Platform / Global' : 'Company workspace'}</Badge>
        <h1 className="text-2xl font-semibold tracking-tight">{user.is_global ? 'Platform overview' : 'Overview'}</h1>
        <p className="text-sm text-muted-foreground">{user.is_global ? 'Manage organizations, access and platform operations.' : 'Your company, branch access and available operations.'}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle>Current company</CardTitle></CardHeader>
          <CardContent className="space-y-2"><p className="font-semibold break-words">{user.company_name}</p><p className="text-sm text-muted-foreground">{user.company_code}</p>
            {user.is_global && <p className="text-sm text-muted-foreground">Platform administration workspace. Tenant business totals are not displayed.</p>}
          </CardContent></Card>
        <Card><CardHeader><CardTitle>Branch access</CardTitle></CardHeader><CardContent className="text-sm">
          {user.is_global ? <p>Platform administration</p> : user.access_scope === 'global' ? <p>All branches in this company</p>
            : branches.length ? <ul className="space-y-2">{branches.map(branch => <li key={branch.id}>{branch.name} ({branch.code})</li>)}</ul>
            : user.branch_ids.length ? <p>Branch information unavailable.</p> : <p>No assigned branches available.</p>}
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>{user.is_global ? 'Platform operations' : 'Available operations'}</CardTitle></CardHeader><CardContent>
        {links.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{links.map(item =>
          <Link className="flex min-h-14 items-center justify-between gap-3 rounded-md border bg-background px-4 py-3 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-accent" key={item.href} href={item.href}>{item.label}<ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Link>)}</div>
          : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No quick actions are available for your current access level.</p>}
      </CardContent></Card>
    </div>
  );
}
