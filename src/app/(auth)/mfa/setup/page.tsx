// src/app/(auth)/mfa/setup/page.tsx
// Initial MFA enrollment: client-side QR code from the one-time setup URI,
// hidden-by-default manual key, then 6-digit verification to activate MFA.
//
// Privacy: the QR is rendered locally in the browser (react-qr-code SVG).
// The setup URI / secret is never sent to any external service and never
// displayed as raw text. No secret is logged.

'use client';

import { Component, type ReactNode, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'react-qr-code';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/** Isolates QR render failures so the manual key path always stays usable. */
class QrErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  constructor(props: { children: ReactNode; onError: () => void }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export default function MfaSetupPage() {
  const router = useRouter();
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
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
        // Accept only a well-formed otpauth URI; anything else cannot be
        // encoded into a trustworthy QR code.
        const uri: unknown = data.otpauth_url;
        if (typeof uri !== 'string' || !uri.startsWith('otpauth://')) {
          setFormError('Could not start MFA setup. Please log in again.');
          return;
        }
        setOtpauthUrl(uri);
        setManualKey(typeof data.manual_key === 'string' ? data.manual_key : null);
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

  const preparing = !otpauthUrl && !formError;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Set up two-factor authentication</CardTitle>
          <CardDescription>
            Your account requires MFA. Scan the QR code with Google Authenticator,
            Microsoft Authenticator, or another TOTP-compatible app, then enter the 6-digit code.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {formError ? (
            <p role="alert" aria-live="assertive" className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              {formError}
            </p>
          ) : null}
          {preparing ? (
            <p aria-live="polite" className="text-sm text-muted-foreground text-center py-8">
              Preparing QR code…
            </p>
          ) : null}
          {otpauthUrl && !qrFailed ? (
            <div className="space-y-2">
              <p id="qr-label" className="text-sm font-medium text-center">
                Scan this QR code
              </p>
              <div
                role="img"
                aria-labelledby="qr-label qr-desc"
                className="mx-auto w-52 h-52 sm:w-64 sm:h-64 rounded-lg border bg-white p-3 [&>svg]:h-full [&>svg]:w-full"
              >
                <QrErrorBoundary onError={() => setQrFailed(true)}>
                  <QRCode value={otpauthUrl} level="M" title="MFA setup QR code" />
                </QrErrorBoundary>
              </div>
              <p id="qr-desc" className="text-xs text-muted-foreground text-center">
                Use Google Authenticator, Microsoft Authenticator, or another TOTP-compatible app.
              </p>
            </div>
          ) : null}
          {otpauthUrl && qrFailed ? (
            <p role="alert" className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              Could not render the QR code. Use the manual setup key below instead.
            </p>
          ) : null}
          {manualKey ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground text-center">
                Can&apos;t scan the QR code?
              </p>
              <div className="flex gap-2">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="manual-key">Manual setup key</Label>
                  <Input
                    id="manual-key"
                    readOnly
                    type={showKey ? 'text' : 'password'}
                    value={showKey ? manualKey : '••••••••••••••••'}
                    onFocus={(e) => e.target.select()}
                    autoComplete="off"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="self-end"
                  onClick={() => setShowKey((v) => !v)}
                  aria-expanded={showKey}
                  aria-controls="manual-key"
                >
                  {showKey ? 'Hide setup key' : 'Show setup key'}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
        <form onSubmit={handleActivate}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Verification code</Label>
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
