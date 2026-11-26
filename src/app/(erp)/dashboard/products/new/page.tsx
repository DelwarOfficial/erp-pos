// src/app/(erp)/dashboard/products/new/page.tsx
// Create product form.

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api/client';
import { ErrorState, LoadingState } from '@/components/shared/StateList';
import { useDashboardSession } from '@/components/dashboard/session';
import { QuickCreateCatalogueItem, type CatalogueKind, type CreatedCatalogueItem } from '@/components/products/QuickCreateCatalogueItem';

interface Category { id: string; name: string; code: string }
interface Brand { id: string; name: string }
interface Unit { id: string; name: string; code: string; allow_fractional: boolean }

export default function NewProductPage() {
  const router = useRouter();
  const t = useTranslations('products');
  const session = useDashboardSession();
  // Same permission the server checks on POST /api/v1/categories and /brands.
  const canManageCatalogue = Boolean(session?.is_global || session?.permissions.includes('category.manage'));
  const [quickCreate, setQuickCreate] = useState<CatalogueKind | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', code: '', category_id: '', brand_id: '', unit_id: '',
    product_type: 'standard', is_serialized: false, track_batches: false,
    reference_cost: 0, default_price: 0, alert_quantity: 0,
    short_description: '', description: '', is_featured: false,
    warranty_period_months: 0,
  });

  useEffect(() => { loadOptions(); }, []);

  async function loadOptions() {
    setOptionsLoading(true); setOptionsError(null);
    try {
      const responses = await Promise.all([
        apiFetch('/api/v1/categories'), apiFetch('/api/v1/brands'), apiFetch('/api/v1/units'),
      ]);
      if (responses.some(response => !response.ok)) throw new Error(t('new.options_failed'));
      const [c, b, u] = await Promise.all(responses.map(response => response.json()));
      if (![c, b, u].every(data => Array.isArray(data.items))) throw new Error(t('new.options_failed'));
      setCategories(c.items ?? []);
      setBrands(b.items ?? []);
      setUnits(u.items ?? []);
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : t('new.options_failed'));
    } finally { setOptionsLoading(false); }
  }

  function handleQuickCreated(kind: CatalogueKind, item: CreatedCatalogueItem) {
    if (kind === 'category') {
      setCategories(prev => [...prev, { id: item.id, name: item.name, code: item.code ?? '' }]);
      setForm(prev => ({ ...prev, category_id: item.id }));
      toast.success(t('quick.saved_category', { name: item.name }));
    } else {
      setBrands(prev => [...prev, { id: item.id, name: item.name }]);
      setForm(prev => ({ ...prev, brand_id: item.id }));
      toast.success(t('quick.saved_brand', { name: item.name }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const idempotencyKey = `product-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await apiFetch('/api/v1/products', {
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
        toast.error(data?.error?.message ?? t('new.failed'));
        return;
      }
      toast.success(t('new.created', { code: data.code }));
      router.push(`/dashboard/products/${data.id}`);
    } catch (e) {
      toast.error(e instanceof Error && !(e instanceof TypeError) ? e.message : t('new.network'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('new.title')}</h1>
        <p className="text-muted-foreground text-pretty">{t('new.subtitle')}</p>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>{t('new.card_title')}</CardTitle>
            <CardDescription>{t('new.required_hint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {optionsLoading && <LoadingState label={t('new.loading_options')} />}
            {optionsError && <ErrorState message={optionsError} onRetry={loadOptions} />}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">{t('field.name')} <span aria-hidden="true">*</span></Label>
                <Input id="name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="min-h-[40px]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="code">{t('field.code')} <span aria-hidden="true">*</span></Label>
                <Input id="code" required value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} className="min-h-[40px]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-app-erp-dashboard-products-new-page-1">{t('field.category')} <span aria-hidden="true">*</span></Label>
                <Select value={form.category_id} onValueChange={v => { if (v) setForm(prev => ({ ...prev, category_id: v })); }}>
                  <SelectTrigger id="field-app-erp-dashboard-products-new-page-1" className="min-h-[40px]"><SelectValue placeholder={t('new.select_category')} /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.code})</SelectItem>)}
                  </SelectContent>
                </Select>
                {canManageCatalogue && (
                  <Button type="button" variant="link" size="sm" className="h-auto min-h-11 px-0" onClick={() => setQuickCreate('category')}>
                    <Plus aria-hidden="true" />{t('new_category')}
                  </Button>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-app-erp-dashboard-products-new-page-2">{t('field.brand')}</Label>
                <Select value={form.brand_id} onValueChange={v => { if (v) setForm(prev => ({ ...prev, brand_id: v })); }}>
                  <SelectTrigger id="field-app-erp-dashboard-products-new-page-2" className="min-h-[40px]"><SelectValue placeholder={t('new.no_brand')} /></SelectTrigger>
                  <SelectContent>
                    {brands.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {canManageCatalogue && (
                  <Button type="button" variant="link" size="sm" className="h-auto min-h-11 px-0" onClick={() => setQuickCreate('brand')}>
                    <Plus aria-hidden="true" />{t('new_brand')}
                  </Button>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-app-erp-dashboard-products-new-page-3">{t('field.unit')} <span aria-hidden="true">*</span></Label>
                <Select value={form.unit_id} onValueChange={v => setForm({ ...form, unit_id: v })}>
                  <SelectTrigger id="field-app-erp-dashboard-products-new-page-3" className="min-h-[40px]"><SelectValue placeholder={t('new.select_unit')} /></SelectTrigger>
                  <SelectContent>
                    {units.map(u => <SelectItem key={u.id} value={u.id}>{u.name} ({u.code}){u.allow_fractional ? ` — ${t('new.fractional')}` : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-app-erp-dashboard-products-new-page-4">{t('field.type')} <span aria-hidden="true">*</span></Label>
                <Select value={form.product_type} onValueChange={v => setForm({ ...form, product_type: v })}>
                  <SelectTrigger id="field-app-erp-dashboard-products-new-page-4" className="min-h-[40px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">{t('type.standard')}</SelectItem>
                    <SelectItem value="combo">{t('type.combo')}</SelectItem>
                    <SelectItem value="service">{t('type.service')}</SelectItem>
                    <SelectItem value="digital">{t('type.digital')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="price">{t('selling_price')}</Label>
                <Input id="price" type="number" step="0.01" min="0" value={form.default_price}
                  onChange={e => setForm({ ...form, default_price: parseFloat(e.target.value) || 0 })} className="min-h-[40px]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cost">{t('purchase_price')}</Label>
                <Input id="cost" type="number" step="0.000001" min="0" value={form.reference_cost}
                  onChange={e => setForm({ ...form, reference_cost: parseFloat(e.target.value) || 0 })} className="min-h-[40px]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alert">{t('quantity')}</Label>
                <Input id="alert" type="number" step="0.0001" min="0" value={form.alert_quantity}
                  onChange={e => setForm({ ...form, alert_quantity: parseFloat(e.target.value) || 0 })} className="min-h-[40px]"
                  aria-describedby="alert-help" />
                <p id="alert-help" className="text-xs text-muted-foreground text-pretty">{t('quantity_help')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="warranty">{t('field.warranty_months')}</Label>
                <Input id="warranty" type="number" min="0" max="600" value={form.warranty_period_months}
                  onChange={e => setForm({ ...form, warranty_period_months: parseInt(e.target.value) || 0 })} className="min-h-[40px]" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="short">{t('field.short_description')}</Label>
              <Input id="short" maxLength={500} value={form.short_description}
                onChange={e => setForm({ ...form, short_description: e.target.value })} className="min-h-[40px]" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="desc">{t('field.description')}</Label>
              <Textarea id="desc" value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>

            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <Switch id="ser" checked={form.is_serialized}
                  onCheckedChange={v => setForm({ ...form, is_serialized: v })}
                  disabled={form.product_type === 'service' || form.product_type === 'digital'} />
                <Label htmlFor="ser">{t('field.serialized')}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="bat" checked={form.track_batches}
                  onCheckedChange={v => setForm({ ...form, track_batches: v })}
                  disabled={form.product_type === 'service' || form.product_type === 'digital'} />
                <Label htmlFor="bat">{t('field.batches')}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="fea" checked={form.is_featured}
                  onCheckedChange={v => setForm({ ...form, is_featured: v })} />
                <Label htmlFor="fea">{t('field.featured')}</Label>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between gap-2">
            <Button type="button" variant="ghost" onClick={() => router.push('/dashboard/products')} className="min-h-[44px]">{t('new.cancel')}</Button>
            <Button type="submit" disabled={loading} className="min-h-[44px]">
              {loading ? t('new.submitting') : t('new.submit')}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* Outside the product <form>: the dialog has a form of its own. */}
      {quickCreate && (
        <QuickCreateCatalogueItem kind={quickCreate} open
          onOpenChange={open => { if (!open) setQuickCreate(null); }}
          onCreated={item => handleQuickCreated(quickCreate, item)} />
      )}
    </div>
  );
}
