'use client';

// Add a customer without leaving checkout.
//
// Uses the customer API as it is: GET /api/v1/customers?search= (name, phone
// or email) to show people who may already be customers, and POST
// /api/v1/customers to save. Nothing here merges records: a matching name is
// shown, never reused silently, and the cashier decides. The mobile number
// follows the reminder rule (normalizeBdMobile) when one is entered.
//
// One Idempotency-Key per set of details: a double click or a retry after a
// lost response cannot save the customer twice; changing the details starts
// a new attempt.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api/client';
import { normalizeBdMobile } from '@/domain/receivables/phone';

export interface CreatedCustomer { id: string; name: string; phone?: string | null }
interface Match { id: string; name: string; phone: string | null; is_active?: boolean }

const MONEY = /^\d{1,15}(\.\d{1,2})?$/;

/** Typed search text that looks like a phone number goes to the mobile field, anything else to the name. */
function splitPrefill(text: string) {
  const digits = text.replace(/[\s\-+().]/g, '');
  return /^\d{6,}$/.test(digits) ? { name: '', phone: text.trim() } : { name: text.trim(), phone: '' };
}

export function QuickCreateCustomer({ open, onOpenChange, prefill, askCreditLimit, onSelected }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill: string;
  /** Show the credit limit field: the sale leaves money owing, and a new customer starts with no credit. */
  askCreditLimit: boolean;
  /** A saved or an existing customer was chosen. */
  onSelected: (customer: CreatedCustomer) => void;
}) {
  const t = useTranslations('pos');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [touched, setTouched] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  // Fresh form each time it opens, filled from what was typed in the search.
  useEffect(() => {
    if (!open) return;
    const p = splitPrefill(prefill);
    setName(p.name); setPhone(p.phone); setCreditLimit(''); setTouched(false); setError(''); setMatches([]);
    attempt.current = null;
    setTimeout(() => (p.phone && !p.name ? nameRef : p.name ? phoneRef : nameRef).current?.focus(), 0);
  }, [open, prefill]);

  const canonical = phone.trim() ? normalizeBdMobile(phone) : null;
  const nameProblem = !name.trim() ? t('add_customer_name_required') : name.trim().length > 200 ? t('add_customer_name_long') : '';
  const phoneProblem = phone.trim() && !canonical ? t('add_customer_phone_invalid') : '';
  const creditProblem = askCreditLimit && creditLimit.trim() && !MONEY.test(creditLimit.trim()) ? t('add_customer_credit_invalid') : '';

  // People who may already be customers: same mobile first, then similar names.
  useEffect(() => {
    if (!open) return;
    const queries = [canonical ? `0${canonical.slice(3)}` : '', name.trim().length >= 2 ? name.trim() : ''].filter(Boolean);
    if (!queries.length) { setMatches([]); return; }
    let alive = true;
    const timer = setTimeout(async () => {
      const found = new Map<string, Match>();
      for (const q of queries) {
        const r = await apiFetch(`/api/v1/customers?search=${encodeURIComponent(q)}&limit=5`).catch(() => null);
        if (r?.ok) for (const c of ((await r.json()).items ?? []) as Match[]) found.set(c.id, c);
      }
      if (alive) setMatches([...found.values()].slice(0, 6));
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [open, name, canonical]);
  const samePhone = (m: Match) => Boolean(canonical && m.phone && normalizeBdMobile(m.phone) === canonical);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (saving) return;
    if (nameProblem || phoneProblem || creditProblem) {
      (nameProblem ? nameRef : phoneRef).current?.focus();
      return;
    }
    const body = {
      name: name.trim(),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(askCreditLimit && creditLimit.trim() ? { credit_limit: Number(creditLimit.trim()) } : {}),
    };
    const payload = JSON.stringify(body);
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: `customer-${crypto.randomUUID()}` };
    setSaving(true); setError('');
    try {
      const r = await apiFetch('/api/v1/customers', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current.key }, body: payload });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(r.status === 403 ? t('add_customer_forbidden') : t('add_customer_failed', { reason: data?.error?.message ?? String(r.status) }));
        return;
      }
      attempt.current = null;
      onSelected({ id: data.id, name: data.name ?? body.name, phone: body.phone ?? null });
      onOpenChange(false);
    } catch {
      // The save may have reached the server; retrying with the same details reuses the same key.
      setError(t('add_customer_network'));
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('add_customer_title')}</DialogTitle>
            <DialogDescription>{t('add_customer_help')}</DialogDescription>
          </DialogHeader>
          <fieldset disabled={saving} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="qc-name">{t('add_customer_name')}<span aria-hidden="true" className="text-destructive"> *</span></Label>
              <Input id="qc-name" ref={nameRef} required aria-required="true" maxLength={200} autoComplete="off" className="h-11"
                value={name} onChange={e => setName(e.target.value)} aria-invalid={touched && !!nameProblem} aria-describedby={touched && nameProblem ? 'qc-name-error' : undefined} />
              {touched && nameProblem ? <p id="qc-name-error" className="text-xs text-destructive">{nameProblem}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-phone">{t('add_customer_phone')}</Label>
              <Input id="qc-phone" ref={phoneRef} type="tel" inputMode="tel" autoComplete="off" maxLength={30} placeholder="01XXXXXXXXX" className="h-11"
                value={phone} onChange={e => setPhone(e.target.value)} aria-invalid={!!phoneProblem} aria-describedby="qc-phone-help" />
              <p id="qc-phone-help" className={`text-xs ${phoneProblem ? 'text-destructive' : 'text-muted-foreground'}`}>{phoneProblem || t('add_customer_phone_help')}</p>
            </div>
            {askCreditLimit ? (
              <div className="space-y-1.5">
                <Label htmlFor="qc-credit">{t('add_customer_credit')}</Label>
                <Input id="qc-credit" inputMode="decimal" autoComplete="off" placeholder="0" className="h-11 tabular-nums"
                  value={creditLimit} onChange={e => setCreditLimit(e.target.value)} aria-invalid={!!creditProblem} aria-describedby="qc-credit-help" />
                <p id="qc-credit-help" className={`text-xs ${creditProblem ? 'text-destructive' : 'text-muted-foreground'}`}>{creditProblem || t('add_customer_credit_help')}</p>
              </div>
            ) : null}
          </fieldset>
          {matches.length ? (
            <section aria-labelledby="qc-matches" className="space-y-2 rounded-md border bg-muted/40 p-3">
              <h3 id="qc-matches" className="text-sm font-medium">{t('add_customer_matches')}</h3>
              <ul className="space-y-1">
                {matches.map(m => (
                  <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">{m.name}{m.phone ? <span className="text-muted-foreground"> · {m.phone}</span> : null}
                      {samePhone(m) ? <strong className="ml-1 text-destructive">{t('add_customer_same_phone')}</strong> : null}</span>
                    <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => { onSelected({ id: m.id, name: m.name, phone: m.phone }); onOpenChange(false); }}>{t('add_customer_use_existing')}</Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm">{error}</p> : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>{t('add_customer_cancel')}</Button>
            <Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}{error ? t('add_customer_retry') : t('add_customer_save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
