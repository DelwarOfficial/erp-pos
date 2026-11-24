'use client';
// Asks for the authenticator code when a sensitive action needs a recent MFA
// check (403 INVALID_MFA with step_up). Registered with apiFetch, which sends
// the original request again once the code is accepted.
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, setStepUpHandler } from '@/lib/api/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function StepUpDialog() {
  const t = useTranslations('step_up');
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const resolver = useRef<((verified: boolean) => void) | null>(null);

  useEffect(() => {
    setStepUpHandler(() => new Promise<boolean>(resolve => {
      resolver.current?.(false); // a newer prompt replaces an unanswered one
      resolver.current = resolve;
      setCode(''); setError(''); setOpen(true);
    }));
    return () => { setStepUpHandler(null); resolver.current?.(false); resolver.current = null; };
  }, []);

  function finish(verified: boolean) {
    resolver.current?.(verified);
    resolver.current = null;
    setOpen(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true); setError('');
    try {
      const res = await apiFetch('/api/v1/auth/mfa/step-up', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ code }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.details?.mfa_setup_required ? t('not_set_up') : (data?.error?.message ?? t('failed')));
        setCode('');
        return;
      }
      finish(true);
    } catch { setError(t('network')); }
    finally { setPending(false); }
  }

  return <Dialog open={open} onOpenChange={next => { if (!next) finish(false); }}>
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('help')}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <Label htmlFor="step-up-code">{t('code')}</Label>
        <Input id="step-up-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus
          value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-invalid={!!error} aria-describedby={error ? 'step-up-error' : undefined} className="min-h-11 text-lg tracking-[0.3em] tabular-nums" />
        {error ? <p id="step-up-error" role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => finish(false)}>{t('cancel')}</Button>
          <Button type="submit" className="min-h-11" disabled={pending || code.length !== 6}>{pending ? t('checking') : t('confirm')}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
