'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api/client';
import { CustomerSchema } from '@/lib/customers/schema';
import { normalizeBdMobile } from '@/domain/receivables/phone';
import { useWorkflowMutation } from '@/hooks/useWorkflowMutation';

export interface CreatedCustomer { id: string; name: string; phone?: string | null }
interface Match extends CreatedCustomer { is_active?: boolean }
type Lookup = { signature: string; items: Match[]; error: string };
const QuickCustomerSchema = CustomerSchema.pick({ name: true, phone: true });

function splitPrefill(text: string) {
  const digits = text.replace(/[\s\-+().]/g, '');
  return /^[\d০-৯]{6,}$/.test(digits) ? { name: '', phone: text.trim() } : { name: text.trim(), phone: '' };
}

/** Uses existing customer search/create rules; matching names are never merged. */
export function QuickCreateCustomer({ open, onOpenChange, prefill, onSelected }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill: string;
  onSelected: (customer: CreatedCustomer) => void;
}) {
  const t = useTranslations('pos');
  const mutation = useWorkflowMutation();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current && !mutation.error) {
      const p = splitPrefill(prefill);
      setName(p.name); setPhone(p.phone); setTouched(false); setLookup(null);
    }
    wasOpen.current = open;
  }, [open, prefill, mutation.error]);

  const body = { name: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) };
  const validation = QuickCustomerSchema.safeParse(body);
  const nameProblem = validation.success ? '' : validation.error.issues.some(issue => issue.path[0] === 'name')
    ? t(body.name ? 'add_customer_name_long' : 'add_customer_name_required') : '';
  const phoneProblem = validation.success ? '' : validation.error.issues.some(issue => issue.path[0] === 'phone') ? t('add_customer_phone_long') : '';
  const signature = JSON.stringify([body.name, body.phone ?? '']);
  const canonical = normalizeBdMobile(body.phone);
  const samePhone = (match: Match) => Boolean(body.phone && match.phone &&
    (canonical ? normalizeBdMobile(match.phone) === canonical : match.phone.trim() === body.phone));

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const queries = [...new Set([body.phone ?? '', canonical ? `0${canonical.slice(3)}` : '', body.name].filter(Boolean))];
    if (!queries.length) { setLookup({ signature, items: [], error: '' }); return; }
    const timer = setTimeout(async () => {
      try {
        const groups = await Promise.all(queries.map(async query => {
          const response = await apiFetch(`/api/v1/customers?search=${encodeURIComponent(query)}&limit=5`, { signal: controller.signal });
          if (!response.ok) throw new Error(response.status === 403 ? t('add_customer_search_forbidden') : t('add_customer_search_failed'));
          const data = await response.json();
          if (!Array.isArray(data.items)) throw new Error(t('add_customer_search_failed'));
          return data.items as Match[];
        }));
        const unique = new Map(groups.flat().map(item => [item.id, item]));
        if (!controller.signal.aborted) setLookup({ signature, items: [...unique.values()], error: '' });
      } catch (cause) {
        if (!controller.signal.aborted) setLookup({ signature, items: [], error: cause instanceof Error ? cause.message : t('add_customer_search_failed') });
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, signature, canonical, lookupAttempt, t]);

  const checked = lookup?.signature === signature;
  const checking = !checked;
  const matches = checked ? [...lookup.items].sort((a, b) => Number(samePhone(b)) - Number(samePhone(a))) : [];
  const lookupError = checked ? lookup.error : '';

  async function save(event: React.FormEvent) {
    event.preventDefault(); setTouched(true);
    if (!validation.success) { (nameProblem ? nameRef : phoneRef).current?.focus(); return; }
    if (mutation.pending || checking || lookupError) return;
    // Only name/phone: retain the API's credit-limit default and permission checks.
    const result = await mutation.mutate<CreatedCustomer>('/api/v1/customers', validation.data);
    if (!result) return;
    onSelected(result);
    onOpenChange(false);
  }

  const saveError = mutation.error ? mutation.errorStatus === 403 ? t('add_customer_forbidden')
    : mutation.errorStatus === null ? t('add_customer_network') : t('add_customer_failed', { reason: mutation.error }) : '';

  return <Dialog open={open} onOpenChange={next => { if (!mutation.pending) onOpenChange(next); }}>
    <DialogContent className="sm:max-w-lg motion-reduce:animate-none" showCloseButton={!mutation.pending}
      onOpenAutoFocus={event => {
        event.preventDefault();
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        nameRef.current?.focus();
      }}
      onCloseAutoFocus={event => {
        if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); }
      }}>
      <form onSubmit={save} noValidate className="min-w-0 space-y-4" aria-busy={mutation.pending}>
        <DialogHeader><DialogTitle>{t('add_customer_title')}</DialogTitle><DialogDescription>{t('add_customer_help')}</DialogDescription></DialogHeader>
        <fieldset disabled={mutation.pending} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="qc-name">{t('add_customer_name')}<span aria-hidden="true"> *</span></Label>
            <Input id="qc-name" ref={nameRef} required maxLength={200} autoComplete="name" className="min-h-11"
              value={name} onChange={event => setName(event.target.value)} aria-invalid={touched && !!nameProblem} aria-describedby={touched && nameProblem ? 'qc-name-error' : undefined} />
            {touched && nameProblem ? <p id="qc-name-error" className="text-sm text-destructive">{nameProblem}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="qc-phone">{t('add_customer_phone')}</Label>
            <Input id="qc-phone" ref={phoneRef} type="tel" autoComplete="tel" maxLength={30} className="min-h-11"
              value={phone} onChange={event => setPhone(event.target.value)} aria-invalid={touched && !!phoneProblem} aria-describedby="qc-phone-help" />
            <p id="qc-phone-help" className={`text-sm ${touched && phoneProblem ? 'text-destructive' : 'text-muted-foreground'}`}>{touched && phoneProblem ? phoneProblem : t('add_customer_phone_help')}</p>
          </div>
        </fieldset>
        <div aria-live="polite" aria-atomic="true">
          {checking ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />{t('add_customer_checking')}</p> : null}
        </div>
        {lookupError ? <div role="alert" className="space-y-2 rounded-lg border p-3 text-sm"><p>{lookupError}</p><Button type="button" variant="outline" className="min-h-11" onClick={() => { setLookup(null); setLookupAttempt(value => value + 1); }}>{t('add_customer_retry_search')}</Button></div> : null}
        {matches.length ? <section aria-labelledby="qc-matches" className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <h3 id="qc-matches" className="text-sm font-medium">{t('add_customer_matches')}</h3>
          <ul className="max-h-48 space-y-2 overflow-y-auto">
            {matches.map(match => <li key={match.id} className="flex min-w-0 items-start justify-between gap-3 text-sm">
              <div className="min-w-0 break-words"><p className="font-medium">{match.name}</p>{match.phone ? <p className="break-all text-muted-foreground">{match.phone}</p> : null}
                {samePhone(match) ? <p className="font-medium">{t('add_customer_same_phone')}</p> : null}
                {match.is_active === false ? <p className="text-muted-foreground">{t('customer_inactive')}</p> : null}</div>
              <Button type="button" variant="outline" className="min-h-11 shrink-0" disabled={mutation.pending || match.is_active === false}
                onClick={() => { onSelected(match); onOpenChange(false); }}>{t('add_customer_use_existing')}</Button>
            </li>)}
          </ul>
          <p className="text-xs leading-5 text-muted-foreground">{t('add_customer_separate_help')}</p>
        </section> : null}
        {saveError ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">{saveError}</p> : null}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="min-h-11" disabled={mutation.pending} onClick={() => onOpenChange(false)}>{t('add_customer_cancel')}</Button>
          <Button type="submit" className="min-h-11" disabled={mutation.pending || checking || !!lookupError}>
            {mutation.pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}
            {mutation.pending ? t('add_customer_saving') : saveError ? t('add_customer_retry') : t(matches.length ? 'add_customer_save_separate' : 'add_customer_save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
