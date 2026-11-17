// src/lib/i18n/format.ts
// Client-safe display formatters. No database or filesystem access, so
// these can be imported from 'use client' components (src/lib/i18n/index.ts
// cannot: it loads translation overrides from the database).
//
// Stored values stay locale-neutral; only display is localized. Every
// date and time is shown in Asia/Dhaka whatever the device is set to.

export type UiLocale = 'bn-BD' | 'en-BD';
export const UI_LOCALES: readonly UiLocale[] = ['en-BD', 'bn-BD'];
export const DEFAULT_UI_LOCALE: UiLocale = 'en-BD';
export const LOCALE_COOKIE = 'erp-locale';
export const BUSINESS_TIME_ZONE = 'Asia/Dhaka';

const CURRENCY_SYMBOL: Record<string, string> = { BDT: '৳', USD: '$', EUR: '€' };

function numberLocale(locale: UiLocale) {
  // en-BD is not shipped by every runtime; en-IN gives the same lakh/crore
  // grouping the market reads (1,25,000.00).
  return locale === 'bn-BD' ? 'bn-BD' : 'en-IN';
}

/** ৳ 1,25,000.00. Returns an em dash for values that are not numbers. */
export function formatMoney(value: number | string | null | undefined, locale: UiLocale = DEFAULT_UI_LOCALE,
  currency: string = 'BDT', decimals: number = 2): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const amount = Math.abs(n).toLocaleString(numberLocale(locale), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  return `${n < 0 ? '−' : ''}${symbol}${symbol.endsWith(' ') ? '' : ' '}${amount}`;
}

export function formatQuantity(value: number | string | null | undefined, locale: UiLocale = DEFAULT_UI_LOCALE, decimals = 0): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString(numberLocale(locale), { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 3) });
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 16 Nov 2026 */
export function formatDate(value: Date | string | number | null | undefined, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString(locale === 'bn-BD' ? 'bn-BD' : 'en-GB',
    { day: '2-digit', month: 'short', year: 'numeric', timeZone: BUSINESS_TIME_ZONE });
}

/** 16 Nov 2026, 9:05 pm */
export function formatDateTime(value: Date | string | number | null | undefined, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleString(locale === 'bn-BD' ? 'bn-BD' : 'en-GB',
    { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: BUSINESS_TIME_ZONE });
}

/** Turns the flat "a.b.c" catalog keys into the nested shape next-intl reads. */
export function nestMessages(flat: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = node[parts[i]];
      if (typeof next !== 'object' || next === null) node[parts[i]] = {};
      node = node[parts[i]] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = value;
  }
  return out;
}
