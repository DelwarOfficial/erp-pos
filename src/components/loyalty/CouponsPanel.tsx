'use client';

// Coupons: list, create and switch off/on. Coupons are never edited or deleted
// once made (their redemptions refer to them). The discount itself is worked
// out by the server at pricing and posting; nothing here computes money.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus, TicketPercent } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api/client';
import { useFormat } from '@/components/i18n/I18nProvider';
import { useDashboardSession } from '@/components/dashboard/session';

interface Coupon {
  id: string; code: string; name: string; discount_type: 'fixed' | 'percentage'; value: string;
  max_discount_amount: string | null; min_order_amount: string; valid_from: string; valid_to: string | null;
  usage_limit: number | null; usage_count: number; is_active: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({ code: '', name: '', discount_type: 'fixed' as 'fixed' | 'percentage', value: '', max_discount_amount: '', min_order_amount: '0', valid_from: today(), valid_to: '', usage_limit: '' });

export function CouponsPanel() {
  const t = useTranslations('coupons');
  const f = useFormat();
  const session = useDashboardSession();
  const canManage = Boolean(session?.is_global || session?.permissions.includes('coupon.manage'));
  const [items, setItems] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  // One key per attempt at the same body, so a retry after a lost response cannot make two coupons.
  const pending = useRef<{ key: string; body: string } | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const response = await apiFetch('/api/v1/coupons');
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? response.statusText);
      setItems(data.items ?? []);
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (showForm) codeRef.current?.focus(); }, [showForm]);

  const set = (field: keyof ReturnType<typeof blank>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(current => ({ ...current, [field]: e.target.value })); pending.current = null;
  };

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setSaveError('');
    const body = JSON.stringify({
      code: form.code.trim(), name: form.name.trim(), discount_type: form.discount_type, value: form.value.trim(),
      min_order_amount: form.min_order_amount.trim() || '0', valid_from: form.valid_from,
      ...(form.discount_type === 'percentage' && form.max_discount_amount.trim() ? { max_discount_amount: form.max_discount_amount.trim() } : {}),
      ...(form.valid_to ? { valid_to: form.valid_to } : {}),
      ...(form.usage_limit.trim() ? { usage_limit: Number(form.usage_limit) } : {}),
    });
    if (pending.current?.body !== body) pending.current = { key: `coupon-${crypto.randomUUID()}`, body };
    try {
      const response = await apiFetch('/api/v1/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key }, body });
      const data = await response.json();
      if (!response.ok) { if (response.status < 500) pending.current = null; throw new Error(data?.error?.message ?? response.statusText); }
      pending.current = null;
      toast.success(t('created', { code: data.code }));
      setForm(blank()); setShowForm(false);
      await load();
    } catch (cause) { setSaveError(t('save_failed', { reason: cause instanceof Error ? cause.message : String(cause) })); }
    finally { setSaving(false); }
  }

  async function toggle(coupon: Coupon) {
    setToggling(coupon.id);
    try {
      const response = await apiFetch(`/api/v1/coupons/${coupon.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `coupon-toggle-${crypto.randomUUID()}` },
        body: JSON.stringify({ is_active: !coupon.is_active }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? response.statusText);
      setItems(current => current.map(row => row.id === coupon.id ? { ...row, is_active: data.is_active } : row));
      toast.success(t(data.is_active ? 'toggled_on' : 'toggled_off', { code: coupon.code }));
    } catch (cause) { toast.error(t('save_failed', { reason: cause instanceof Error ? cause.message : String(cause) })); }
    finally { setToggling(null); }
  }

  const offer = (c: Coupon) => {
    const main = c.discount_type === 'percentage'
      ? c.max_discount_amount ? t('offer_percent_cap', { value: Number(c.value), cap: f.money(c.max_discount_amount) }) : t('offer_percent', { value: Number(c.value) })
      : t('offer_fixed', { amount: f.money(c.value) });
    return Number(c.min_order_amount) > 0 ? `${main} · ${t('offer_min', { amount: f.money(c.min_order_amount) })}` : main;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base"><TicketPercent className="h-5 w-5" aria-hidden="true" /><h2>{t('title')}</h2></CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        {canManage && !showForm ? <Button type="button" className="min-h-11" onClick={() => setShowForm(true)}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />{t('create_title')}</Button> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <form onSubmit={create} className="space-y-3 rounded-md border p-4" aria-labelledby="coupon-form-title">
            <h3 id="coupon-form-title" className="text-sm font-semibold">{t('create_title')}</h3>
            <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="coupon-new-code">{t('field_code')}</Label>
                <Input ref={codeRef} id="coupon-new-code" required minLength={3} maxLength={30} pattern="[A-Za-z0-9_\-]+" autoComplete="off" className="h-11 uppercase"
                  aria-describedby="coupon-new-code-hint" value={form.code} onChange={set('code')} />
                <p id="coupon-new-code-hint" className="text-xs text-muted-foreground">{t('field_code_hint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-new-name">{t('field_name')}</Label>
                <Input id="coupon-new-name" required maxLength={120} className="h-11" value={form.name} onChange={set('name')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-new-type">{t('field_type')}</Label>
                <select id="coupon-new-type" className="h-11 w-full rounded-md border bg-background px-2" value={form.discount_type} onChange={set('discount_type')}>
                  <option value="fixed">{t('type_fixed')}</option><option value="percentage">{t('type_percentage')}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-new-value">{t(form.discount_type === 'fixed' ? 'field_value_fixed' : 'field_value_percentage')}</Label>
                <Input id="coupon-new-value" required type="number" inputMode="decimal" min="0.01" max={form.discount_type === 'percentage' ? '100' : undefined} step="0.01" className="h-11 tabular-nums" value={form.value} onChange={set('value')} />
              </div>
              {form.discount_type === 'percentage' && (
                <div className="space-y-1.5">
                  <Label htmlFor="coupon-new-cap">{t('field_cap')}</Label>
                  <Input id="coupon-new-cap" type="number" inputMode="decimal" min="0.01" step="0.01" className="h-11 tabular-nums" value={form.max_discount_amount} onChange={set('max_discount_amount')} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="coupon-new-min">{t('field_min')}</Label>
                <Input id="coupon-new-min" type="number" inputMode="decimal" min="0" step="0.01" className="h-11 tabular-nums" value={form.min_order_amount} onChange={set('min_order_amount')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-new-from">{t('field_from')}</Label>
                <Input id="coupon-new-from" required type="date" className="h-11" value={form.valid_from} onChange={set('valid_from')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-new-to">{t('field_to')}</Label>
                <Input id="coupon-new-to" type="date" min={form.valid_from} className="h-11" value={form.valid_to} onChange={set('valid_to')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-new-limit">{t('field_limit')}</Label>
                <Input id="coupon-new-limit" type="number" inputMode="numeric" min="1" step="1" className="h-11 tabular-nums" value={form.usage_limit} onChange={set('usage_limit')} />
              </div>
            </fieldset>
            {saveError ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm">{saveError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-11" disabled={saving}>{saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('creating')}</> : t('create')}</Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => { setShowForm(false); setSaveError(''); }}>{t('cancel')}</Button>
            </div>
          </form>
        )}

        {loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('loading')}</p>
          : loadError ? (
            <div role="alert" className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm">
              <p>{t('load_failed', { reason: loadError })}</p>
              <Button type="button" variant="outline" onClick={() => void load()}>{t('retry')}</Button>
            </div>
          ) : items.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t(canManage ? 'empty' : 'empty_read')}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr><th scope="col" className="py-2 pr-3 font-medium">{t('col_code')}</th><th scope="col" className="py-2 pr-3 font-medium">{t('col_offer')}</th>
                    <th scope="col" className="py-2 pr-3 font-medium">{t('col_valid')}</th><th scope="col" className="py-2 pr-3 font-medium">{t('col_used')}</th>
                    <th scope="col" className="py-2 pr-3 font-medium">{t('col_status')}</th>{canManage ? <th scope="col" className="py-2"><span className="sr-only">{t('col_status')}</span></th> : null}</tr>
                </thead>
                <tbody>
                  {items.map(c => (
                    <tr key={c.id} className="border-t">
                      <td className="py-2 pr-3"><code className="font-mono font-medium">{c.code}</code><div className="text-xs text-muted-foreground">{c.name}</div></td>
                      <td className="py-2 pr-3">{offer(c)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{c.valid_to ? t('valid_range', { from: f.date(c.valid_from), to: f.date(c.valid_to) }) : t('valid_open', { from: f.date(c.valid_from) })}</td>
                      <td className="py-2 pr-3 tabular-nums">{c.usage_limit !== null ? t('used_of', { count: c.usage_count, limit: c.usage_limit }) : c.usage_count}</td>
                      <td className="py-2 pr-3"><Badge variant={c.is_active ? 'default' : 'secondary'}>{t(c.is_active ? 'active' : 'inactive')}</Badge></td>
                      {canManage ? (
                        <td className="py-2 text-right">
                          <Button type="button" variant="outline" size="sm" className="min-h-10" disabled={toggling === c.id} onClick={() => void toggle(c)}>
                            {toggling === c.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : t(c.is_active ? 'turn_off' : 'turn_on', { code: c.code })}
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </CardContent>
    </Card>
  );
}
