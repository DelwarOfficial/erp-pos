// src/app/(erp)/dashboard/layout.tsx
// Dashboard shell with responsive sidebar. Loads current user via /api/v1/me.
// - Desktop (md+): persistent left sidebar.
// - Mobile (< md): hidden sidebar; hamburger button reveals a slide-over drawer.
// - Loading + error states during /api/v1/me fetch (redirects to /login on auth failure).

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Building2, LogOut, ShieldCheck, Activity, Settings, Server, BookOpen, Package, FolderTree, Flag, Boxes, ShoppingCart, Users, Receipt, Clock, CreditCard, Scale, Truck, Wrench, Gift, UserCog, Megaphone, Webhook, ShieldAlert, FileText, ChevronDown, Menu, Loader2, AlertCircle, Building, Landmark, Wallet, MessageSquare, FileBarChart, LifeBuoy, Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTitle, SheetHeader, SheetDescription } from '@/components/ui/sheet';
import { DashboardSession, type DashboardUser } from '@/components/dashboard/session';
import { ThemeControl } from '@/components/theme-control';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { apiFetch } from '@/lib/api/client';

const NAV_ITEMS: Array<{ href: string; icon: React.ComponentType<{ className?: string }>; label: string; requiresPermission?: string }> = [
  { href: '/dashboard', icon: Activity, label: 'Overview' },
  { href: '/dashboard/access/users', icon: Users, label: 'Access Control — Users', requiresPermission: 'user.read' },
  { href: '/dashboard/access/roles', icon: ShieldCheck, label: 'Access Control — Roles', requiresPermission: 'role.read' },
  { href: '/dashboard/access/permissions', icon: ShieldCheck, label: 'Access Control — Permissions', requiresPermission: 'role.read' },
  { href: '/dashboard/pos', icon: CreditCard, label: 'POS — New Sale' },
  { href: '/dashboard/sales', icon: Receipt, label: 'Sales' },
  { href: '/dashboard/cashier', icon: Clock, label: 'Cashier Shifts' },
  { href: '/dashboard/payments', icon: Banknote, label: 'Payments' },
  { href: '/dashboard/products', icon: Package, label: 'Products' },
  { href: '/dashboard/catalogue', icon: FolderTree, label: 'Catalogue' },
  { href: '/dashboard/inventory', icon: Boxes, label: 'Inventory' },
  { href: '/dashboard/purchases', icon: ShoppingCart, label: 'Purchases' },
  { href: '/dashboard/parties', icon: Users, label: 'Customers & Suppliers' },
  { href: '/dashboard/accounting', icon: Scale, label: 'Accounting' },
  { href: '/dashboard/assets', icon: Building, label: 'Fixed Assets' },
  { href: '/dashboard/bank-reconciliation', icon: Landmark, label: 'Bank Reconciliation' },
  { href: '/dashboard/deliveries', icon: Truck, label: 'Deliveries' },
  { href: '/dashboard/service', icon: Wrench, label: 'Service' },
  { href: '/dashboard/crm', icon: Megaphone, label: 'CRM — Leads' },
  { href: '/dashboard/hr', icon: UserCog, label: 'HR — Employees' },
  { href: '/dashboard/gift-cards', icon: Gift, label: 'Gift Cards' },
  { href: '/dashboard/integrations', icon: Webhook, label: 'Integrations' },
  { href: '/dashboard/imports', icon: FileText, label: 'Import / Export' },
  { href: '/dashboard/feature-flags', icon: Flag, label: 'Feature Flags' },
  { href: '/dashboard/security', icon: ShieldCheck, label: 'Security Events' },
  { href: '/dashboard/risk-tuning', icon: ShieldAlert, label: 'Risk Tuning' },
  { href: '/dashboard/audit', icon: BookOpen, label: 'Audit Log' },
  { href: '/dashboard/onboarding', icon: Building2, label: 'Onboard Tenant', requiresPermission: 'platform.onboarding.execute' },
  { href: '/dashboard/system', icon: Server, label: 'System Health', requiresPermission: 'system.config.view' },
  { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
  { href: '/dashboard/expenses', icon: Wallet, label: 'Expenses' },
  { href: '/dashboard/communications', icon: MessageSquare, label: 'Communications' },
  { href: '/dashboard/reports', icon: FileBarChart, label: 'Reports' },
  { href: '/dashboard/support', icon: LifeBuoy, label: 'Support' },
];

const NAV_PERMISSIONS: Record<string, string> = {
  '/dashboard/pos': 'sale.post', '/dashboard/sales': 'sale.read', '/dashboard/cashier': 'shift.read',
  '/dashboard/payments': 'payment.read', '/dashboard/products': 'product.read', '/dashboard/catalogue': 'product.read',
  '/dashboard/inventory': 'inventory.read', '/dashboard/purchases': 'purchase.read', '/dashboard/parties': 'customer.read',
  '/dashboard/accounting': 'journal.read', '/dashboard/assets': 'asset.view.branch',
  '/dashboard/bank-reconciliation': 'bank.reconciliation.view.company', '/dashboard/deliveries': 'delivery.read',
  '/dashboard/service': 'service.read', '/dashboard/crm': 'crm.lead.read', '/dashboard/hr': 'employee.read',
  '/dashboard/gift-cards': 'gift_card.read', '/dashboard/integrations': 'company.read',
  '/dashboard/imports': 'import.execute.company', '/dashboard/feature-flags': 'system.config.view',
  '/dashboard/security': 'audit.view', '/dashboard/risk-tuning': 'audit.view', '/dashboard/audit': 'audit.view',
  '/dashboard/expenses': 'expense.read', '/dashboard/communications': 'communication.campaign.manage.company',
  '/dashboard/reports': 'report.execute',
};

const NAV_GROUPS = [
  { label: 'Overview', routes: [''] },
  { label: 'Sales', routes: ['pos', 'sales', 'cashier', 'payments', 'gift-cards'] },
  { label: 'Catalogue & stock', routes: ['products', 'catalogue', 'inventory'] },
  { label: 'Procurement & contacts', routes: ['purchases', 'parties'] },
  { label: 'Finance', routes: ['accounting', 'assets', 'bank-reconciliation', 'expenses'] },
  { label: 'Operations', routes: ['deliveries', 'service', 'crm', 'hr', 'communications', 'reports'] },
  { label: 'Access control', routes: ['access/users', 'access/roles', 'access/permissions'] },
  { label: 'Administration', routes: ['integrations', 'imports', 'feature-flags', 'security', 'risk-tuning', 'audit', 'onboarding', 'system', 'settings', 'support'] },
];

function isActiveRoute(pathname: string, href: string) {
  return pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/'));
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/v1/me')
      .then(async r => {
        if (cancelled) return;
        if (r.status === 401 || r.status === 403) {
          // Auth failed — redirect to login.
          router.replace('/login');
          throw new Error('Not authenticated');
        }
        if (!r.ok) throw new Error(`Failed to load user (HTTP ${r.status})`);
        return r.json();
      })
      .then(d => {
        if (cancelled) return;
        if (!d?.user) throw new Error('Invalid /me response');
        setUser(d.user);
      })
      .catch(e => {
        if (cancelled) return;
        if (e?.message !== 'Not authenticated') {
          setAuthError(e instanceof Error ? e.message : 'Failed to load session');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [router]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const handleLogout = useCallback(async () => {
    try { await apiFetch('/api/v1/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    router.push('/login');
  }, [router]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p role="status" className="text-sm text-muted-foreground">Loading dashboard…</p>
      </div>
    );
  }

  // ── Error state ──
  if (authError && !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <div role="alert" className="text-center max-w-md">
          <h2 className="text-lg font-semibold">Session error</h2>
          <p className="text-sm text-muted-foreground mt-1">{authError}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
          <Button onClick={() => router.push('/login')}>Go to login</Button>
        </div>
      </div>
    );
  }

  if (!user) {
    // Should have been redirected already; render nothing to avoid flashes.
    return null;
  }

  const initials = user.name.split(' ').map(p => p?.[0]).slice(0, 2).join('').toUpperCase();

  const SidebarContent = (
    <nav className="space-y-2 p-3" aria-label="Primary">
      {NAV_GROUPS.map(group => {
        const items = group.routes.flatMap(route => {
          const item = NAV_ITEMS.find(item => item.href === `/dashboard${route ? '/' + route : ''}`);
          if (!item) return [];
          const permission = item.requiresPermission ?? NAV_PERMISSIONS[item.href];
          return permission && !user.is_global && !user.permissions.includes(permission) ? [] : [item];
        });
        if (!items.length) return null;
        const groupActive = items.some(item => isActiveRoute(pathname, item.href));
        return <Collapsible key={group.label} defaultOpen className="group/nav">
          <CollapsibleTrigger className={`flex min-h-9 w-full items-center justify-between rounded-md px-3 text-xs font-semibold transition-colors hover:bg-sidebar-accent ${groupActive ? 'text-sidebar-primary' : 'text-muted-foreground'}`}>
            {group.label}<ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=closed]/nav:-rotate-90" aria-hidden="true" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-0.5">
            {items.map(item => {
              const active = isActiveRoute(pathname, item.href);
              const Icon = item.icon;
              return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
                className={`flex min-h-10 items-center gap-2.5 rounded-md border-l-2 px-3 py-2 text-sm transition-colors ${active ? 'border-sidebar-primary bg-sidebar-accent font-semibold text-sidebar-accent-foreground' : 'border-transparent text-sidebar-foreground hover:bg-sidebar-accent'}`}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label.replace('Access Control ? ', '').replace('CRM ? ', '').replace('HR ? ', '')}</span>
              </Link>;
            })}
          </CollapsibleContent>
        </Collapsible>;
      })}
    </nav>
  );

  const branches = (user.branches ?? []).filter(branch => user.branch_ids.includes(branch.id));
  const branchLabel = user.is_global ? 'Platform / Global' : user.access_scope === 'global' ? 'All company branches'
    : branches.length === 1 ? branches[0].name : `${user.branch_ids.length} assigned branches`;

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">Skip to content</a>
      <header className="border-b bg-card sticky top-0 z-30">
        <div className="flex min-h-16 items-center justify-between px-3 py-2 sm:px-5 gap-2">
          <div className="flex items-center gap-3 min-w-0">
            {/* Hamburger — mobile only */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden flex-shrink-0"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <Building2 className="hidden sm:block h-5 w-5 text-primary flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0"><div className="font-semibold truncate" title={user.company_name}>{user.company_name}</div>
              <div className="text-xs font-medium text-muted-foreground truncate" title={branchLabel}>{branchLabel}</div></div>
            <Badge variant="outline" className="text-xs hidden sm:inline-flex">{user.company_code}</Badge>
            
            {user.mfa_enabled && user.mfa_verified && (
              <Badge variant="secondary" className="text-xs gap-1 hidden md:inline-flex">
                <ShieldCheck className="h-3 w-3" /> MFA
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 sm:gap-3 shrink-0">
            <ThemeControl />
            <div className="text-right text-sm hidden sm:block">
              <div className="font-medium truncate max-w-[160px]">{user.name}</div>
              <div className="text-xs text-muted-foreground truncate max-w-[160px]">{user.email}</div>
            </div>
            <Avatar className="hidden sm:flex flex-shrink-0">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <Button variant="ghost" size="icon" onClick={handleLogout} title="Sign out" aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="w-60 lg:w-64 border-r bg-card hidden md:block flex-shrink-0">
          <div className="overflow-y-auto h-[calc(100dvh-4rem)] sticky top-16 overscroll-contain">
            {SidebarContent}
          </div>
        </aside>

        {/* Mobile drawer */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 p-0 max-w-[85vw]">
            <SheetHeader className="border-b">
              <SheetTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                <span className="truncate">{user.company_name}</span>
              </SheetTitle>
              <SheetDescription>{branchLabel}</SheetDescription>
            </SheetHeader>
            <div className="overflow-y-auto flex-1 min-h-0 overscroll-contain">
              {SidebarContent}
            </div>
          </SheetContent>
        </Sheet>

        <main id="main-content" tabIndex={-1} className="flex-1 p-3 sm:p-5 lg:p-6 min-w-0">
          <DashboardSession.Provider value={user}><div className="mx-auto w-full max-w-[1600px]">{children}</div></DashboardSession.Provider>
        </main>
      </div>
    </div>
  );
}
