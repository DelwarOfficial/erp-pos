// src/app/(auth)/login/page.tsx
// Email+password login. On success: redirect to /dashboard or /mfa.

'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { LanguageControl } from '@/components/i18n/LanguageControl';
import { ThemeControl } from '@/components/theme-control';
import { toast } from 'sonner';

// Server error codes that have a plain-language explanation in the catalog.
const KNOWN_ERRORS = ['UNAUTHORIZED', 'ACCOUNT_LOCKED', 'RATE_LIMITED', 'COMPANY_SUSPENDED'] as const;

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyCode, setCompanyCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function validate() {
    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) errors.email = t('error.email_required');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = t('error.email_invalid');
    if (!password) errors.password = t('error.password_required');
    setFieldErrors(errors);
    if (errors.email) emailRef.current?.focus();
    else if (errors.password) passwordRef.current?.focus();
    return !errors.email && !errors.password;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
        },
        credentials: 'include',
        body: JSON.stringify({
          email,
          password,
          ...(companyCode ? { company_code: companyCode } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data?.error?.code as string | undefined;
        const known = KNOWN_ERRORS.find(item => item === code);
        const message: string = known ? t(`error.${known}`) : data?.error?.message ?? t('error.generic');
        setFormError(message);
        toast.error(message);
        return;
      }
      if (data.mfa_setup_required) {
        router.push('/mfa/setup');
      } else if (data.mfa_required) {
        router.push('/mfa');
      } else {
        toast.success(t('welcome'));
        router.push('/dashboard');
      }
    } catch {
      const message = t('error.network');
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <div className="flex justify-end gap-1 p-3">
        <LanguageControl />
        <ThemeControl />
      </div>
      <main className="flex flex-1 items-center justify-center p-4 pb-16">
        <Card className="w-full max-w-md shadow-sm">
          <CardHeader className="space-y-1">
            <CardTitle><h1 className="text-2xl font-semibold tracking-tight text-balance">{t('title')}</h1></CardTitle>
            <CardDescription className="text-pretty">{t('subtitle')}</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit} className="space-y-6" aria-busy={loading} noValidate>
            <CardContent className="space-y-4">
              {formError ? (
                <p role="alert" aria-live="assertive" className="text-sm text-foreground rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                  {formError}
                </p>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="email">{t('email')}</Label>
                <Input
                  ref={emailRef}
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  required
                  aria-required="true"
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (fieldErrors.email) setFieldErrors(prev => ({ ...prev, email: undefined })); }}
                  placeholder={t('email_placeholder')}
                />
                {fieldErrors.email && <p id="email-error" role="alert" className="text-sm text-destructive">{fieldErrors.email}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t('password')}</Label>
                <div className="relative">
                  <Input
                    ref={passwordRef}
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    aria-required="true"
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (fieldErrors.password) setFieldErrors(prev => ({ ...prev, password: undefined })); }}
                    className="pr-12"
                  />
                  <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-1/2 -translate-y-1/2"
                    aria-pressed={showPassword} aria-label={showPassword ? t('hide_password') : t('show_password')}
                    title={showPassword ? t('hide_password') : t('show_password')} onClick={() => setShowPassword(prev => !prev)}>
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </Button>
                </div>
                {fieldErrors.password && <p id="password-error" role="alert" className="text-sm text-destructive">{fieldErrors.password}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="company_code">{t('company_code')}</Label>
                <Input
                  id="company_code"
                  aria-describedby="company-code-help"
                  type="text"
                  autoCapitalize="characters"
                  autoComplete="organization"
                  value={companyCode}
                  onChange={(e) => setCompanyCode(e.target.value.toUpperCase())}
                  placeholder={t('company_code_placeholder')}
                />
                <p id="company-code-help" className="text-xs text-muted-foreground text-pretty">
                  {t('company_code_help')}
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {loading ? t('submitting') : t('submit')}
              </Button>
              <Link href="/reset-password" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:underline">
                {t('forgot')}
              </Link>
            </CardFooter>
          </form>
        </Card>
      </main>
    </div>
  );
}
