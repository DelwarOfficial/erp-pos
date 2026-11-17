'use client';

// Client-side translations for the dashboard. The catalogs are the flat
// JSON files in public/locales; the root layout picks the locale from the
// erp-locale cookie and hands the merged messages down. A key missing from
// bn-BD falls back to its en-BD text because the layout merges en-BD first.

import { NextIntlClientProvider, useLocale } from 'next-intl';
import { useMemo } from 'react';
import {
  BUSINESS_TIME_ZONE, formatDate, formatDateTime, formatMoney, formatQuantity, type UiLocale,
} from '@/lib/i18n/format';

export function I18nProvider({ locale, messages, children }: {
  locale: UiLocale; messages: Record<string, unknown>; children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={BUSINESS_TIME_ZONE}
      onError={() => { /* a missing key renders its fallback; never break a till */ }}
      getMessageFallback={({ key }) => key.split('.').pop()!.replace(/_/g, ' ')}>
      {children}
    </NextIntlClientProvider>
  );
}

/** Money, quantity and date formatters bound to the current locale. */
export function useFormat() {
  const locale = useLocale() as UiLocale;
  return useMemo(() => ({
    locale,
    money: (value: number | string | null | undefined, currency?: string) => formatMoney(value, locale, currency),
    quantity: (value: number | string | null | undefined, decimals?: number) => formatQuantity(value, locale, decimals),
    date: (value: Date | string | number | null | undefined) => formatDate(value, locale),
    dateTime: (value: Date | string | number | null | undefined) => formatDateTime(value, locale),
  }), [locale]);
}
