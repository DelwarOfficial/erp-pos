'use client';

import Link from 'next/link';
import { ArrowUpRight, Building2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { useDashboardSession } from '@/components/dashboard/session';

const workflows = [
  { href: '/dashboard/pos', label: 'pos', permission: 'sale.post' },
  { href: '/dashboard/inventory', label: 'inventory', permission: 'inventory.read' },
  { href: '/dashboard/purchases', label: 'purchases', permission: 'purchase.read' },
  { href: '/dashboard/reports', label: 'reports', permission: 'report.execute' },
];

export default function DashboardPage() {
  const user = useDashboardSession();
  const t = useTranslations('home');
  if (!user) return <p role="status">{t('session_missing')}</p>;
  const platformWorkflows = [
    { href: '/dashboard/access/users', label: 'users' },
    { href: '/dashboard/access/roles', label: 'roles' },
    { href: '/dashboard/onboarding', label: 'onboarding' },
    { href: '/dashboard/system', label: 'system' },
  ];
  const links = user.is_global ? platformWorkflows : workflows.filter(item => !user.is_global && user.permissions.includes(item.permission));
  const branches = (user.branches ?? []).filter(branch => user.branch_ids.includes(branch.id));
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Badge variant="outline" className="gap-1.5">{user.is_global ? <ShieldCheck className="size-3.5" aria-hidden="true" /> : <Building2 className="size-3.5" aria-hidden="true" />}{user.is_global ? t('badge_platform') : t('badge_company')}</Badge>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{t('welcome', { name: user.name.split(' ')[0] })}</h1>
        <p className="text-sm text-muted-foreground text-pretty">{user.is_global ? t('subtitle_platform') : t('subtitle_company')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle>{t('company_title')}</CardTitle></CardHeader>
          <CardContent className="space-y-2"><p className="font-semibold break-words">{user.company_name}</p><p className="text-sm text-muted-foreground">{user.company_code}</p>
            {user.is_global && <p className="text-sm text-muted-foreground">{t('company_platform_note')}</p>}
          </CardContent></Card>
        <Card><CardHeader><CardTitle>{t('branches_title')}</CardTitle></CardHeader><CardContent className="text-sm">
          {user.is_global ? <p>{t('branches_platform')}</p> : user.access_scope === 'global' ? <p>{t('branches_all')}</p>
            : branches.length ? <ul className="space-y-2">{branches.map(branch => <li key={branch.id}>{branch.name} ({branch.code})</li>)}</ul>
            : user.branch_ids.length ? <p>{t('branches_unavailable')}</p> : <p>{t('branches_none')}</p>}
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>{user.is_global ? t('actions_platform') : t('actions_company')}</CardTitle></CardHeader><CardContent>
        {links.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{links.map(item =>
          <Link className="flex min-h-14 items-center justify-between gap-3 rounded-md border bg-background px-4 py-3 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-accent" key={item.href} href={item.href}>{t(`link.${item.label}`)}<ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Link>)}</div>
          : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">{t('actions_none')}</p>}
      </CardContent></Card>
    </div>
  );
}
