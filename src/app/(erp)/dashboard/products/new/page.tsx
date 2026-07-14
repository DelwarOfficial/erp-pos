// src/app/(erp)/dashboard/products/new/page.tsx
// Create product form.

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface Category { id: string; name: string; code: string }
interface Brand { id: string; name: string }
interface Unit { id: string; name: string; code: string; allow_fractional: boolean }

export default function NewProductPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: '', code: '', category_id: '', brand_id: '', unit_id: '',
    product_type: 'standard', is_serialized: false, track_batches: false,
    reference_cost: 0, default_price: 0, alert_quantity: 0,
    short_description: '', description: '', is_featured: false,
    warranty_period_months: 0,
  });

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/categories').then(r => r.json()),
      fetch('/api/v1/brands').then(r => r.json()),
      fetch('/api/v1/units').then(r => r.json()),
    ]).then(([c, b, u]) => {
      setCategories(c.items ?? []);
      setBrands(b.items ?? []);
      setUnits(u.items ?? []);
    }).catch(console.error);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const idempotencyKey = `product-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await fetch('/api/v1/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          ...form,
          brand_id: form.brand_id || undefined,
          warranty_period_months: form.warranty_period_months || undefined,
          reference_cost: Number(form.reference_cost),
          default_price: Number(form.default_price),
          alert_quantity: Number(form.alert_quantity),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Failed to create product');
        return;
      }
      toast.success(`Product ${data.code} created (inactive)`);
      router.push(`/dashboard/products/${data.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Product</h1>
        <p className="text-muted-foreground">
          Products are created inactive. After adding a unit option + barcode, click Activate to validate and enable.
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>Product Details</CardTitle>
            <CardDescription>All fields marked with * are required.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="min-h-[40px]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="code">Code *</Label>
                <Input id="code" required value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} className="min-h-[40px]" />
              </div>
              <div className="space-y-1.5">
                <Label>Category *</Label>
                <Select value={form.category_id} onValueChange={v => setForm({ ...form, category_id: v })}>
                  <SelectTrigger className="min-h-[40px]"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Brand</Label>
                <Select value={form.brand_id} onValueChange={v => setForm({ ...form, brand_id: v })}>
                  <SelectTrigger className="min-h-[40px]"><SelectValue placeholder="No brand" /></SelectTrigger>
                  <SelectContent>
                    {brands.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Unit *</Label>
                <Select value={form.unit_id} onValueChange={v => setForm({ ...form, unit_id: v })}>
                  <SelectTrigger className="min-h-[40px]"><SelectValue placeholder="Select unit" /></SelectTrigger>
                  <SelectContent>
                    {units.map(u => <SelectItem key={u.id} value={u.id}>{u.name} ({u.code}){u.allow_fractional ? ' — fractional' : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Type *</Label>
                <Select value={form.product_type} onValueChange={v => setForm({ ...form, product_type: v })}>
                  <SelectTrigger className="min-h-[40px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="combo">Combo</SelectItem>
                    <SelectItem value="service">Service</SelectItem>
                    <SelectItem value="digital">Digital</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="price">Default Price (BDT)</Label>
                <Input id="price" type="number" step="0.01" min="0" value={form.default_price}
                  onChange={e => setForm({ ...form, default_price: parseFloat(e.target.value) || 0 })} className="min-h-[40px]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cost">Reference Cost (BDT)</Label>
                <Input id="cost" type="number" step="0.000001" min="0" value={form.reference_cost}
                  onChange={e => setForm({ ...form, reference_cost: parseFloat(e.target.value) || 0 })} className="min-h-[40px]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alert">Alert Quantity</Label>
                <Input id="alert" type="number" step="0.0001" min="0" value={form.alert_quantity}
                  onChange={e => setForm({ ...form, alert_quantity: parseFloat(e.target.value) || 0 })} className="min-h-[40px]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="warranty">Warranty (months)</Label>
                <Input id="warranty" type="number" min="0" max="600" value={form.warranty_period_months}
                  onChange={e => setForm({ ...form, warranty_period_months: parseInt(e.target.value) || 0 })} className="min-h-[40px]" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="short">Short Description</Label>
              <Input id="short" maxLength={500} value={form.short_description}
                onChange={e => setForm({ ...form, short_description: e.target.value })} className="min-h-[40px]" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="desc">Full Description</Label>
              <Textarea id="desc" value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>

            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <Switch id="ser" checked={form.is_serialized}
                  onCheckedChange={v => setForm({ ...form, is_serialized: v })}
                  disabled={form.product_type === 'service' || form.product_type === 'digital'} />
                <Label htmlFor="ser">Serialized (IMEI/tracked)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="bat" checked={form.track_batches}
                  onCheckedChange={v => setForm({ ...form, track_batches: v })}
                  disabled={form.product_type === 'service' || form.product_type === 'digital'} />
                <Label htmlFor="bat">Track Batches</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="fea" checked={form.is_featured}
                  onCheckedChange={v => setForm({ ...form, is_featured: v })} />
                <Label htmlFor="fea">Featured</Label>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between gap-2">
            <Button type="button" variant="ghost" onClick={() => router.push('/dashboard/products')} className="min-h-[44px]">Cancel</Button>
            <Button type="submit" disabled={loading} className="min-h-[44px]">
              {loading ? 'Creating...' : 'Create Product (inactive)'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
