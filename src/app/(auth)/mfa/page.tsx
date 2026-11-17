// src/app/(auth)/mfa/page.tsx
// 6-digit TOTP verification. On success: redirect to /dashboard.

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export default function MfaPage() {
  const router = useRouter();
  const t = useTranslations('auth');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check that an MFA challenge is actually pending
    fetch('/api/v1/me').then(r => {
      if (r.ok) router.push('/dashboard');
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) {
      toast.error(t('mfa.incomplete'));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message ?? t('mfa.failed'));
        return;
      }
      toast.success(t('mfa.success'));
      router.push('/dashboard');
    } catch (e) {
      toast.error(t('error.network'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="space-y-1">
          <CardTitle><h1 className="text-2xl font-semibold tracking-tight text-balance">{t('mfa.title')}</h1></CardTitle>
          <CardDescription className="text-pretty">{t('mfa.subtitle')}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit} className="space-y-6" aria-busy={loading}>
          <CardContent className="flex justify-center py-6">
            <InputOTP aria-label={t('mfa.code_label')} autoFocus autoComplete="one-time-code" maxLength={6} value={code} onChange={(v) => setCode(v)}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
              {loading ? t('mfa.submitting') : t('mfa.submit')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => router.push('/login')}
            >
              {t('mfa.back')}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
