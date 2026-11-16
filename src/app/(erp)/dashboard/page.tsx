'use client';

import Link from 'next/link';
import { ArrowUpRight, Building2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboardSession } from '@/components/dashboard/session';

const workflows = [
  { href: '/dashboard/pos', label: 'Make a sale', permission: 'sale.post' },
  { href: '/dashboard/inventory', label: 'Check stock', permission: 'inventory.read' },
  { href: '/dashboard/purchases', label: 'Buy from suppliers', permission: 'purchase.read' },
  { href: '/dashboard/reports', label: 'See reports', permission: 'report.execute' },
];

export default function DashboardPage() {
  const user = useDashboardSession();
  if (!user) return <p role="status">We couldn't load your account details. Please refresh the page.</p>;
  const platformWorkflows = [
    { href: '/dashboard/access/users', label: 'Manage users' },
    { href: '/dashboard/access/roles', label: 'Manage roles' },
    { href: '/dashboard/onboarding', label: 'Add a company' },
    { href: '/dashboard/system', label: 'Check system status' },
  ];
  const links = user.is_global ? platformWorkflows : workflows.filter(item => !user.is_global && user.permissions.includes(item.permission));
  const branches = (user.branches ?? []).filter(branch => user.branch_ids.includes(branch.id));
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Badge variant="outline" className="gap-1.5">{user.is_global ? <ShieldCheck className="size-3.5" aria-hidden="true" /> : <Building2 className="size-3.5" aria-hidden="true" />}{user.is_global ? 'Platform admin' : 'Your workspace'}</Badge>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {user.name.split(' ')[0]}</h1>
        <p className="text-sm text-muted-foreground">{user.is_global ? 'Add companies, manage who can sign in, and keep the system running.' : 'Here is your company, the branches you can work in, and shortcuts to get started.'}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle>Your company</CardTitle></CardHeader>
          <CardContent className="space-y-2"><p className="font-semibold break-words">{user.company_name}</p><p className="text-sm text-muted-foreground">{user.company_code}</p>
            {user.is_global && <p className="text-sm text-muted-foreground">This is the admin area. Sales and stock figures for individual companies are not shown here.</p>}
          </CardContent></Card>
        <Card><CardHeader><CardTitle>Your branches</CardTitle></CardHeader><CardContent className="text-sm">
          {user.is_global ? <p>You manage the whole platform, not a single branch.</p> : user.access_scope === 'global' ? <p>You can work in every branch of this company.</p>
            : branches.length ? <ul className="space-y-2">{branches.map(branch => <li key={branch.id}>{branch.name} ({branch.code})</li>)}</ul>
            : user.branch_ids.length ? <p>We couldn't load your branch names. Please refresh the page.</p> : <p>No branch has been assigned to you yet. Ask your manager to add you to one.</p>}
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>{user.is_global ? 'Admin shortcuts' : 'Quick actions'}</CardTitle></CardHeader><CardContent>
        {links.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{links.map(item =>
          <Link className="flex min-h-14 items-center justify-between gap-3 rounded-md border bg-background px-4 py-3 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-accent" key={item.href} href={item.href}>{item.label}<ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Link>)}</div>
          : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No shortcuts yet. Ask your admin for access and they will appear here.</p>}
      </CardContent></Card>
    </div>
  );
}
