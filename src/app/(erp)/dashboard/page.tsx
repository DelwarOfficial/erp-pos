'use client';

import Link from 'next/link';
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
  const links = workflows.filter(item => !user.is_global && user.permissions.includes(item.permission));
  const branches = (user.branches ?? []).filter(branch => user.branch_ids.includes(branch.id));
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Overview</h1>
        <p className="text-muted-foreground">Your workspace and available operations.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle>Current company</CardTitle></CardHeader>
          <CardContent><p>{user.company_name}</p><p className="text-sm text-muted-foreground">{user.company_code}</p>
            {user.is_global && <p>Platform administration workspace. Tenant business totals are not displayed.</p>}
          </CardContent></Card>
        <Card><CardHeader><CardTitle>Branch access</CardTitle></CardHeader><CardContent>
          {user.is_global ? <p>Platform administration</p> : user.access_scope === 'global' ? <p>All branches in this company</p>
            : branches.length ? <ul>{branches.map(branch => <li key={branch.id}>{branch.name} ({branch.code})</li>)}</ul>
            : user.branch_ids.length ? <p>Branch information unavailable.</p> : <p>No assigned branches available.</p>}
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Available operations</CardTitle></CardHeader><CardContent>
        {links.length ? <div className="flex flex-wrap gap-4">{links.map(item =>
          <Link className="rounded-md border px-4 py-3 underline" key={item.href} href={item.href}>{item.label}</Link>)}</div>
          : <p>No operational shortcuts available for your access.</p>}
      </CardContent></Card>
    </div>
  );
}
