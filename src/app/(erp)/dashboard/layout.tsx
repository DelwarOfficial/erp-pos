// src/app/(erp)/dashboard/layout.tsx
// Dashboard shell with sidebar. Loads current user via /api/v1/me.

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, LogOut, ShieldCheck, User as UserIcon, Activity, Settings, Server, BookOpen, Package, FolderTree, Flag, Boxes, ShoppingCart, Users, Receipt, Clock, CreditCard, Scale, Truck, Wrench, Gift, UserCog, Megaphone, Webhook, ShieldAlert, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/me')
      .then(r => {
        if (!r.ok) throw new Error('Not authenticated');
        return r.json();
      })
      .then(d => setUser(d.user))
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleLogout() {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!user) return null;

  const initials = user.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="border-b bg-white">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-primary" />
            <span className="font-semibold">{user.company_name}</span>
            <Badge variant="outline" className="text-xs">{user.company_code}</Badge>
            {user.is_global && <Badge variant="secondary" className="text-xs">GLOBAL</Badge>}
            {user.mfa_enabled && user.mfa_verified && (
              <Badge variant="secondary" className="text-xs gap-1">
                <ShieldCheck className="h-3 w-3" /> MFA
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-sm">
              <div className="font-medium">{user.name}</div>
              <div className="text-xs text-muted-foreground">{user.email}</div>
            </div>
            <Avatar>
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <Button variant="ghost" size="icon" onClick={handleLogout} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="w-60 border-r bg-white p-3 space-y-1 hidden md:block">
          <NavItem href="/dashboard" icon={Activity} label="Overview" />
          <NavItem href="/dashboard/pos" icon={CreditCard} label="POS — New Sale" />
          <NavItem href="/dashboard/sales" icon={Receipt} label="Sales" />
          <NavItem href="/dashboard/cashier" icon={Clock} label="Cashier Shifts" />
          <NavItem href="/dashboard/products" icon={Package} label="Products" />
          <NavItem href="/dashboard/catalogue" icon={FolderTree} label="Catalogue" />
          <NavItem href="/dashboard/inventory" icon={Boxes} label="Inventory" />
          <NavItem href="/dashboard/purchases" icon={ShoppingCart} label="Purchases" />
          <NavItem href="/dashboard/parties" icon={Users} label="Customers & Suppliers" />
          <NavItem href="/dashboard/accounting" icon={Scale} label="Accounting" />
          <NavItem href="/dashboard/deliveries" icon={Truck} label="Deliveries" />
          <NavItem href="/dashboard/service" icon={Wrench} label="Service" />
          <NavItem href="/dashboard/crm" icon={Megaphone} label="CRM — Leads" />
          <NavItem href="/dashboard/hr" icon={UserCog} label="HR — Employees" />
          <NavItem href="/dashboard/gift-cards" icon={Gift} label="Gift Cards" />
          <NavItem href="/dashboard/integrations" icon={Webhook} label="Integrations" />
          <NavItem href="/dashboard/imports" icon={FileText} label="Import / Export" />
          <NavItem href="/dashboard/feature-flags" icon={Flag} label="Feature Flags" />
          <NavItem href="/dashboard/security" icon={ShieldCheck} label="Security Events" />
          <NavItem href="/dashboard/risk-tuning" icon={ShieldAlert} label="Risk Tuning" />
          <NavItem href="/dashboard/audit" icon={BookOpen} label="Audit Log" />
          <NavItem href="/dashboard/onboarding" icon={Building2} label="Onboard Tenant"
            requiresPermission="platform.onboarding.execute" userPerms={user.permissions} />
          <NavItem href="/dashboard/system" icon={Server} label="System Health" />
          <NavItem href="/dashboard/settings" icon={Settings} label="Settings" />
        </aside>

        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavItem({
  href,
  icon: Icon,
  label,
  requiresPermission,
  userPerms,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  requiresPermission?: string;
  userPerms?: string[];
}) {
  if (requiresPermission && userPerms && !userPerms.includes(requiresPermission)) {
    return null;
  }
  return (
    <Link
      href={href}
      className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-slate-100 transition-colors"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      {label}
    </Link>
  );
}
