// src/app/(auth)/mfa/setup/page.tsx
// Initial MFA enrollment: displays the one-time otpauth URI + manual key,
// then verifies the 6-digit code to activate MFA.

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function MfaSetupPage() {
  const router = useRouter();
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/auth/mfa/setup', { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setFormError(data?.error?.message ?? 'Could not start MFA setup. Please log in again.');
          return;
        }
        setOtpauthUrl(data.otpauth_url ?? null);
        setManualKey(data.manual_key ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setFormError(e instanceof Error ? e.message : 'Network error');
      });
    return () => { cancelled = true; };
  }, []);

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setFormError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    setFormError(null);
    try {
      const res = await fetch('/api/v1/auth/mfa/setup/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message: string = data?.error?.message ?? 'MFA activation failed';
        setFormError(message);
        toast.error(message);
        return;
      }
      toast.success('MFA activated');
      router.push('/dashboard');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error';
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Set up two-factor authentication</CardTitle>
          <CardDescription>
            Your account requires MFA. Scan the setup link with Google Authenticator,
            Microsoft Authenticator, or any compatible app, then enter the 6-digit code.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {formError ? (
            <p role="alert" aria-live="assertive" className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              {formError}
            </p>
          ) : null}
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
            <li>Open your authenticator app and add a new account.</li>
            <li>Enter the manual setup key below (or open the setup link).</li>
            <li>Type the 6-digit code shown by the app and press Verify.</li>
          </ol>
          {otpauthUrl ? (
            <div className="space-y-2">
              <Label htmlFor="otpauth">Setup link (open on a device with the app)</Label>
              <Input id="otpauth" readOnly value={otpauthUrl} onFocus={(e) => e.target.select()} />
            </div>
          ) : null}
          {manualKey ? (
            <div className="space-y-2">
              <Label htmlFor="manual-key">Manual setup key</Label>
              <div className="flex gap-2">
                <Input
                  id="manual-key"
                  readOnly
                  type={showKey ? 'text' : 'password'}
                  value={manualKey}
                  onFocus={(e) => e.target.select()}
                />
                <Button type="button" variant="outline" onClick={() => setShowKey((v) => !v)}>
                  {showKey ? 'Hide' : 'Show'}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
        <form onSubmit={handleActivate}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">6-digit code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={loading || !otpauthUrl}>
              {loading ? 'Verifying…' : 'Verify and activate'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
