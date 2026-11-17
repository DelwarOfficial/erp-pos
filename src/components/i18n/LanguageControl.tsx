'use client';

import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LOCALE_COOKIE, UI_LOCALES, type UiLocale } from '@/lib/i18n/format';

/** Switches the interface language. The choice is a display preference only. */
export function LanguageControl() {
  const t = useTranslations('shell');
  const locale = useLocale();
  const router = useRouter();
  const choose = (next: string) => {
    if (!UI_LOCALES.includes(next as UiLocale) || next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" aria-label={t('language')} title={t('language')}>
        <Languages aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup value={locale} onValueChange={choose}>
        <DropdownMenuRadioItem value="en-BD" lang="en">{t('language_en')}</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="bn-BD" lang="bn">{t('language_bn')}</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
