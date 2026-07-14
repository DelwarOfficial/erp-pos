// src/app/(erp)/dashboard/onboarding/page.tsx
// Platform_operations-only: onboard a new tenant (§20.D01).

'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Building2, CheckCircle2 } from 'lucide-react';

export default function OnboardingPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<null | {
    company_id: string;
    company_code: string;
    status: string;
    branch_id: string;
    warehouse_id: string;
    admin_user_id: string;
    admin_user_email: string;
    next_step: string;
  }>(null);
  const [form, setForm] = useState({
    legal_name: '',
    display_name: '',
    code: '',
    bin: '',
    tin: '',
    branch_name: 'Main Branch',
    branch_code: 'MAIN',
    warehouse_name: 'Main Warehouse',
    warehouse_code: 'WH-MAIN',
    admin_name: '',
    admin_email: '',
    admin_password: '',
  });
  const [vatRegistered, setVatRegistered] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(false);
    setResult(null);
    try {
      const idempotencyKey = `onboard-${form.code}-${form.admin_email}-${Date.now()}`;
      const res = await fetch('/api/v1/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          company: {
            legal_name: form.legal_name,
            display_name: form.display_name || form.legal_name,
            code: form.code,
            base_currency_code: 'BDT',
            timezone: 'Asia/Dhaka',
            country_code: 'BD',
            default_locale: 'bn-BD',
            bin: form.bin || undefined,
            tin: form.tin || undefined,
            vat_registered: vatRegistered,
            fiscal_year_start_month: 7,
          },
          branch: {
            name: form.branch_name,
            code: form.branch_code,
          },
          warehouse: {
            name: form.warehouse_name,
            code: form.warehouse_code,
            warehouse_type: 'retail',
          },
          admin_user: {
            name: form.admin_name,
            email: form.admin_email,
            password: form.admin_password,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Onboarding failed');
        return;
      }
      setResult(data);
      toast.success(`Company ${data.company_code} onboarded (suspended)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Building2 className="h-6 w-6" /> Tenant Onboarding
        </h1>
        <p className="text-muted-foreground">
          Platform operations only. Creates a new company in <code>suspended</code> status.
          Per §20.D01 — no public signup.
        </p>
      </div>

      {result && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="text-green-800 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" /> Onboarded Successfully
            </CardTitle>
            <CardDescription className="text-green-700">
              Company is in <strong>suspended</strong> status. Activate after admin completes MFA setup.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-1 font-mono">
            <div>company_id: {result.company_id}</div>
            <div>branch_id: {result.branch_id}</div>
            <div>warehouse_id: {result.warehouse_id}</div>
            <div>admin_user_id: {result.admin_user_id}</div>
            <div>admin_email: {result.admin_user_email}</div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>New Company</CardTitle>
          <CardDescription>All fields required. Seeded company + branch + warehouse + admin + system roles in one transaction.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <h3 className="font-medium text-sm uppercase text-muted-foreground">Company</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="legal_name">Legal Name</Label>
                  <Input id="legal_name" required value={form.legal_name}
                    onChange={e => setForm({ ...form, legal_name: e.target.value })}
                    placeholder="ACME Electronics Ltd." />
                </div>
                <div>
                  <Label htmlFor="code">Code (uppercase)</Label>
                  <Input id="code" required pattern="[A-Z0-9_-]+" value={form.code}
                    onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    placeholder="ACME" />
                </div>
                <div>
                  <Label htmlFor="bin">BIN</Label>
                  <Input id="bin" value={form.bin}
                    onChange={e => setForm({ ...form, bin: e.target.value })}
                    placeholder="1234567890123" />
                </div>
                <div>
                  <Label htmlFor="tin">TIN</Label>
                  <Input id="tin" value={form.tin}
                    onChange={e => setForm({ ...form, tin: e.target.value })}
                    placeholder="123456789012" />
                </div>
                <div className="col-span-2 flex items-center gap-3">
                  <Switch id="vat" checked={vatRegistered} onCheckedChange={setVatRegistered} />
                  <Label htmlFor="vat">VAT Registered</Label>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium text-sm uppercase text-muted-foreground">First Branch + Warehouse</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="branch_name">Branch Name</Label>
                  <Input id="branch_name" required value={form.branch_name}
                    onChange={e => setForm({ ...form, branch_name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="branch_code">Branch Code</Label>
                  <Input id="branch_code" required value={form.branch_code}
                    onChange={e => setForm({ ...form, branch_code: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <Label htmlFor="wh_name">Warehouse Name</Label>
                  <Input id="wh_name" required value={form.warehouse_name}
                    onChange={e => setForm({ ...form, warehouse_name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="wh_code">Warehouse Code</Label>
                  <Input id="wh_code" required value={form.warehouse_code}
                    onChange={e => setForm({ ...form, warehouse_code: e.target.value.toUpperCase() })} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium text-sm uppercase text-muted-foreground">First Admin (Owner)</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label htmlFor="admin_name">Name</Label>
                  <Input id="admin_name" required value={form.admin_name}
                    onChange={e => setForm({ ...form, admin_name: e.target.value })}
                    placeholder="Jane Doe" />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="admin_email">Email</Label>
                  <Input id="admin_email" type="email" required value={form.admin_email}
                    onChange={e => setForm({ ...form, admin_email: e.target.value.toLowerCase() })}
                    placeholder="admin@acme.bd" />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="admin_password">Initial Password (min 12 chars)</Label>
                  <Input id="admin_password" type="password" required minLength={12} value={form.admin_password}
                    onChange={e => setForm({ ...form, admin_password: e.target.value })}
                    placeholder="••••••••••••" />
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Onboarding…' : 'Onboard Company (suspended)'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
