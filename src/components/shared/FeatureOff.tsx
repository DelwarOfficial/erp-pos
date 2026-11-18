'use client';

// A module switched off for this company is not an error: retrying cannot
// help, so the page says what is going on and where it is controlled instead
// of showing a red alert with a Retry button.
//
// The API answers 403 FEATURE_NOT_ENABLED (src/lib/featureFlags) for a
// switched-off module. Pages call throwIfFeatureOff() on a failed response and
// render <FeatureOffNotice> when they catch FeatureOffError.

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PowerOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDashboardSession } from '@/components/dashboard/session';

export class FeatureOffError extends Error {
  constructor(readonly flagKey: string) { super(`Feature ${flagKey} is switched off`); }
}

/** Throws FeatureOffError when an API error body says the module is switched off. */
export function throwIfFeatureOff(data: { error?: { code?: string; details?: { flag_key?: string } } } | null | undefined) {
  if (data?.error?.code === 'FEATURE_NOT_ENABLED') throw new FeatureOffError(data.error.details?.flag_key ?? '');
}

export function FeatureOffNotice({ module }: { module: string }) {
  const t = useTranslations('feature_off');
  const session = useDashboardSession();
  const canSeeFlags = Boolean(session?.is_global || session?.permissions.includes('system.config.view'));
  return (
    <section role="status" aria-labelledby="feature-off-title" className="space-y-3 rounded-xl border bg-muted/40 p-5">
      <h2 id="feature-off-title" className="flex items-center gap-2 text-base font-semibold">
        <PowerOff className="size-5 text-muted-foreground" aria-hidden="true" />{t('title', { module })}
      </h2>
      <p className="text-sm text-muted-foreground text-pretty">{t(canSeeFlags ? 'body_admin' : 'body_user', { module })}</p>
      {canSeeFlags ? <Button asChild variant="outline"><Link href="/dashboard/feature-flags">{t('open_flags')}</Link></Button> : null}
    </section>
  );
}
