// src/components/products/QuickCreateCatalogueItem.tsx
// Add a category or brand from the product form without leaving it.
//
// Posts to the same endpoints as Catalogue Management (POST /api/v1/categories,
// POST /api/v1/brands) with the same fields and limits; the server checks
// category.manage and rejects duplicates, and both errors are shown here.

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api/client';

export type CatalogueKind = 'category' | 'brand';
export interface CreatedCatalogueItem { id: string; name: string; code?: string }

// Same limits as CategoryCreateSchema / BrandCreateSchema on the server.
const NAME_MAX = 120;
const CODE_MAX = 40;

interface Props {
  kind: CatalogueKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (item: CreatedCatalogueItem) => void;
}

export function QuickCreateCatalogueItem({ kind, open, onOpenChange, onCreated }: Props) {
  const t = useTranslations('products.quick');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ name?: string; code?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);
  // One key per attempt to save this entry, so a retry after a dropped
  // connection replays the same request instead of creating a second item.
  const keyRef = useRef<string>('');

  useEffect(() => {
    if (open) { setName(''); setCode(''); setErrors({}); keyRef.current = ''; }
  }, [open]);

  function validate() {
    const next: typeof errors = {};
    const n = name.trim(); const c = code.trim();
    if (!n) next.name = t('name_required');
    else if (n.length > NAME_MAX) next.name = t('too_long', { max: NAME_MAX });
    if (kind === 'category') {
      if (!c) next.code = t('code_required');
      else if (c.length > CODE_MAX) next.code = t('too_long', { max: CODE_MAX });
    }
    return next;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation(); // never submits the product form around it
    const found = validate();
    setErrors(found);
    if (found.name || found.code) return;
    const body = kind === 'category' ? { name: name.trim(), code: code.trim() } : { name: name.trim() };
    if (!keyRef.current) keyRef.current = `${kind === 'category' ? 'cat' : 'brand'}-${crypto.randomUUID()}`;
    setSaving(true);
    try {
      const res = await apiFetch(kind === 'category' ? '/api/v1/categories' : '/api/v1/brands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyRef.current },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A rejected entry gets a fresh key once it is corrected.
        keyRef.current = '';
        if (res.status === 403) { setErrors({ form: t('forbidden') }); return; }
        const message: string = data?.error?.message ?? t('failed');
        // Duplicates come back as 409: the name for a brand, the code for a category.
        if (res.status === 409) setErrors(kind === 'category' ? { code: message } : { name: message });
        else setErrors({ form: message });
        return;
      }
      onCreated({ id: data.id, name: data.name, code: data.code });
      onOpenChange(false);
    } catch {
      setErrors({ form: t('network') });
    } finally {
      setSaving(false);
    }
  }

  const prefix = `quick-${kind}`;
  return (
    <Dialog open={open} onOpenChange={next => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md motion-reduce:animate-none" showCloseButton={!saving}>
        <form onSubmit={save} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t(kind === 'category' ? 'category_title' : 'brand_title')}</DialogTitle>
            <DialogDescription>{t(kind === 'category' ? 'category_help' : 'brand_help')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-name`}>{t('name')} <span aria-hidden="true">*</span></Label>
            <Input id={`${prefix}-name`} autoFocus required aria-required="true" maxLength={NAME_MAX}
              value={name} onChange={e => setName(e.target.value)}
              placeholder={t(kind === 'category' ? 'category_name_placeholder' : 'brand_name_placeholder')}
              aria-invalid={!!errors.name} aria-describedby={errors.name ? `${prefix}-name-error` : undefined} className="min-h-11" />
            {errors.name && <p id={`${prefix}-name-error`} role="alert" className="text-sm text-destructive">{errors.name}</p>}
          </div>
          {kind === 'category' && (
            <div className="space-y-1.5">
              <Label htmlFor={`${prefix}-code`}>{t('code')} <span aria-hidden="true">*</span></Label>
              <Input id={`${prefix}-code`} required aria-required="true" maxLength={CODE_MAX}
                value={code} onChange={e => setCode(e.target.value.toUpperCase())}
                placeholder={t('category_code_placeholder')}
                aria-invalid={!!errors.code} aria-describedby={errors.code ? `${prefix}-code-error` : undefined} className="min-h-11 font-mono" />
              {errors.code && <p id={`${prefix}-code-error`} role="alert" className="text-sm text-destructive">{errors.code}</p>}
            </div>
          )}
          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" className="min-h-11" disabled={saving} onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
            <Button type="submit" className="min-h-11" disabled={saving}>{saving ? t('saving') : t('save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
