// src/components/shared/StateList.tsx
// Reusable loading / error / empty state panels for list pages.
// Avoids duplicating UI markup across every dashboard list page.

'use client';

import { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, AlertCircle, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Centered spinner with optional label. */
export function LoadingState({ label }: { label?: string }) {
  const t = useTranslations('state');
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span className="text-sm">{label ?? t('loading')}</span>
    </div>
  );
}

/** Error block with retry button. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTranslations('state');
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 gap-3 text-center">
      <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
      <div role="alert" className="space-y-1">
        <p className="text-sm font-medium text-foreground">{t('error_title')}</p>
        <p className="text-xs text-muted-foreground max-w-md break-words">{message}</p>
      </div>
      {onRetry && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>{t('retry')}</Button>
      )}
    </div>
  );
}

/** Friendly "no data" message. */
export function EmptyState({ message, icon, action }: { message: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 gap-3 text-center">
      {icon ?? <Inbox className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />}
      <p className="text-sm text-muted-foreground max-w-md">{message}</p>
      {action}
    </div>
  );
}
