// src/app/(erp)/dashboard/layout.tsx
// Dashboard shell with responsive sidebar. Loads current user via /api/v1/me.
// - Desktop (md+): persistent left sidebar.
// - Mobile (< md): hidden sidebar; hamburger button reveals a slide-over drawer.
// - Loading + error states during /api/v1/me fetch (redirects to /login on auth failure).

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Building2, LogOut, ShieldCheck, Activity, Settings, Server, BookOpen, Package, FolderTree, Flag, Boxes, ShoppingCart, Users, Receipt, Clock, CreditCard, Scale, Truck, Wrench, Gift, UserCog, Megaphone, Webhook, ShieldAlert, FileText, Menu, Loader2, AlertCircle, Building, Landmark, Wallet, MessageSquare, FileBarChart, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTitle, SheetHeader } from '@/components/ui/sheet';

interface MeUser {
  id: string;
  name: string;
  email: string;
  company_code: string;
  company_name: string;
  access_scope: string;
  is_global: boolean;
  mfa_enabled: boolean;
  mfa_verified: boolean;
  branch_ids: string[];
  roles: { id: string; name: string; is_system: boolean }[];
  permissions: string[];
}

const NAV_ITEMS: Array<{ href: string; icon: React.ComponentType<{ className?: string }>; label: string; requiresPermission?: string }> = [
  { href: '/dashboard', icon: Activity, label: 'Overview' },
  { href: '/dashboard/pos', icon: CreditCard, label: 'POS — New Sale' },
  { href: '/dashboard/sales', icon: Receipt, label: 'Sales' },
  { href: '/dashboard/cashier', icon: Clock, label: 'Cashier Shifts' },
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
  { href: '/dashboard/system', icon: Server, label: 'System Health' },
  { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
  { href: '/dashboard/expenses', icon: Wallet, label: 'Expenses' },
  { href: '/dashboard/communications', icon: MessageSquare, label: 'Communications' },
  { href: '/dashboard/reports', icon: FileBarChart, label: 'Reports' },
  { href: '/dashboard/support', icon: LifeBuoy, label: 'Support' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/me')
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
    try { await fetch('/api/v1/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    router.push('/login');
  }, [router]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading dashboard…</p>
      </div>
    );
  }

  // ── Error state ──
  if (authError && !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-4 px-4">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <div className="text-center max-w-md">
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
    <nav className="flex flex-col gap-0.5 p-3" aria-label="Primary">
      {NAV_ITEMS.map(item => {
        if (item.requiresPermission && !user.permissions.includes(item.requiresPermission)) return null;
        const active = pathname === item.href || pathname.startsWith(item.href + '/');
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-slate-100 transition-colors min-h-[40px] ${
              active ? 'bg-slate-100 font-medium text-foreground' : 'text-foreground/80'
            }`}
          >
            <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="border-b bg-white sticky top-0 z-30">
        <div className="flex h-14 items-center justify-between px-4 gap-3">
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
            <Building2 className="h-5 w-5 text-primary flex-shrink-0" />
            <span className="font-semibold truncate">{user.company_name}</span>
            <Badge variant="outline" className="text-xs hidden sm:inline-flex">{user.company_code}</Badge>
            {user.is_global && <Badge variant="secondary" className="text-xs hidden sm:inline-flex">GLOBAL</Badge>}
            {user.mfa_enabled && user.mfa_verified && (
              <Badge variant="secondary" className="text-xs gap-1 hidden md:inline-flex">
                <ShieldCheck className="h-3 w-3" /> MFA
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-right text-sm hidden sm:block">
              <div className="font-medium truncate max-w-[160px]">{user.name}</div>
              <div className="text-xs text-muted-foreground truncate max-w-[160px]">{user.email}</div>
            </div>
            <Avatar className="flex-shrink-0">
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
        <aside className="w-60 border-r bg-white hidden md:block flex-shrink-0">
          <div className="overflow-y-auto max-h-[calc(100vh-3.5rem)] sticky top-14">
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
            </SheetHeader>
            <div className="overflow-y-auto flex-1">
              {SidebarContent}
            </div>
          </SheetContent>
        </Sheet>

        <main className="flex-1 p-4 md:p-6 overflow-auto min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
