// src/app/(erp)/dashboard/parties/page.tsx
// Customers + Suppliers management hub.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, Users, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';

interface Customer { id: string; name: string; phone: string | null; email: string | null; credit_limit: string; is_active: boolean }
interface Supplier { id: string; name: string; phone: string | null; email: string | null; currency_code: string; payment_terms_days: number; is_active: boolean }

export default function PartiesPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, sRes] = await Promise.all([
        fetch('/api/v1/customers?limit=50'),
        fetch('/api/v1/suppliers?limit=50'),
      ]);
      const [c, s] = await Promise.all([cRes.json(), sRes.json()]);
      if (!cRes.ok) throw new Error(c?.error?.message ?? 'Failed to load customers');
      if (!sRes.ok) throw new Error(s?.error?.message ?? 'Failed to load suppliers');
      setCustomers(c.items ?? []);
      setSuppliers(s.items ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="h-6 w-6" /> Customers & Suppliers</h1>
        <p className="text-muted-foreground">Master party records. Opening balances posted as dated journal entries (M4).</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Users className="h-5 w-5" /> Customers ({customers.length})</CardTitle>
              <CardDescription>Walk-in sales use NULL customer_id.</CardDescription>
            </div>
            <Button size="icon" variant="outline" onClick={() => setShowCustomerForm(!showCustomerForm)} aria-label="Add customer" className="min-h-[40px] min-w-[40px]">
              <Plus className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {showCustomerForm && <CustomerForm onCreated={() => { setShowCustomerForm(false); load(); }} />}
            {loading ? (
              <LoadingState label="Loading customers…" />
            ) : error ? (
              <ErrorState message={error} onRetry={load} />
            ) : customers.length === 0 ? (
              <EmptyState message="No customers yet." />
            ) : (
              <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
                {customers.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-2 border rounded text-sm gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{c.phone ?? c.email ?? '—'}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <Badge variant="outline" className="text-xs">৳ {parseFloat(c.credit_limit).toFixed(0)}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Truck className="h-5 w-5" /> Suppliers ({suppliers.length})</CardTitle>
              <CardDescription>Suppliers have a currency + payment terms.</CardDescription>
            </div>
            <Button size="icon" variant="outline" onClick={() => setShowSupplierForm(!showSupplierForm)} aria-label="Add supplier" className="min-h-[40px] min-w-[40px]">
              <Plus className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {showSupplierForm && <SupplierForm onCreated={() => { setShowSupplierForm(false); load(); }} />}
            {loading ? (
              <LoadingState label="Loading suppliers…" />
            ) : error ? (
              <ErrorState message={error} onRetry={load} />
            ) : suppliers.length === 0 ? (
              <EmptyState message="No suppliers yet." />
            ) : (
              <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
                {suppliers.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-2 border rounded text-sm gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{s.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{s.phone ?? s.email ?? '—'}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <Badge variant="outline" className="text-xs">{s.currency_code}</Badge>
                      <div className="text-xs text-muted-foreground">{s.payment_terms_days}d terms</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CustomerForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [creditLimit, setCreditLimit] = useState('0');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/v1/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `cust-${Date.now()}` },
        body: JSON.stringify({ name, phone: phone || undefined, email: email || undefined, credit_limit: Number(creditLimit) }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success('Customer created');
      onCreated();
    } finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="border rounded p-3 mb-3 space-y-3">
      <Input placeholder="Name *" value={name} onChange={e => setName(e.target.value)} required className="min-h-[40px]" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} className="min-h-[40px]" />
        <Input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} className="min-h-[40px]" />
      </div>
      <Input placeholder="Credit limit (BDT)" type="number" value={creditLimit} onChange={e => setCreditLimit(e.target.value)} className="min-h-[40px]" />
      <Button type="submit" size="sm" disabled={loading} className="min-h-[40px]">{loading ? 'Creating...' : 'Create'}</Button>
    </form>
  );
}

function SupplierForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [currency, setCurrency] = useState('BDT');
  const [termsDays, setTermsDays] = useState('0');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/v1/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `sup-${Date.now()}` },
        body: JSON.stringify({ name, phone: phone || undefined, email: email || undefined, currency_code: currency, payment_terms_days: Number(termsDays) }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success('Supplier created');
      onCreated();
    } finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="border rounded p-3 mb-3 space-y-3">
      <Input placeholder="Name *" value={name} onChange={e => setName(e.target.value)} required className="min-h-[40px]" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} className="min-h-[40px]" />
        <Input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} className="min-h-[40px]" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <select className="border rounded px-2 py-1.5 text-sm min-h-[40px] bg-background" value={currency} onChange={e => setCurrency(e.target.value)}>
          <option value="BDT">BDT</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </select>
        <Input placeholder="Payment terms (days)" type="number" value={termsDays} onChange={e => setTermsDays(e.target.value)} className="min-h-[40px]" />
      </div>
      <Button type="submit" size="sm" disabled={loading} className="min-h-[40px]">{loading ? 'Creating...' : 'Create'}</Button>
    </form>
  );
}
