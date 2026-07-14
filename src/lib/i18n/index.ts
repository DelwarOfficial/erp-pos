// src/lib/i18n/index.ts
// Localization per §20.D19.
//
// Two locales are mandatory: bn-BD (Bangla, default) and en-BD (English).
// Missing keys fall back to en-BD. Translation overrides are stored per-
// company in `translation_overrides`. Noto Sans Bengali is loaded as a web
// font for UI and embedded in PDFs.

import { db } from '../db';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const SUPPORTED_LOCALES = ['bn-BD', 'en-BD'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'bn-BD';
export const FALLBACK_LOCALE: Locale = 'en-BD';

// Core translation keys — kept version-controlled in this file.
// Company-specific overrides live in `translation_overrides`.
// External JSON files in public/locales/{locale}/common.json provide the
// full message catalog; the inline defaults below serve as a fallback for
// server-side rendering when filesystem access isn't available.

// Load external JSON translations (server-side only)
let externalTranslations: Record<Locale, Record<string, string>> | null = null;
function loadExternalTranslations(): Record<Locale, Record<string, string>> {
  if (externalTranslations) return externalTranslations;
  externalTranslations = { 'bn-BD': {}, 'en-BD': {} };
  try {
    for (const locale of SUPPORTED_LOCALES) {
      const filePath = join(process.cwd(), 'public', 'locales', locale, 'common.json');
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf8');
        externalTranslations[locale] = JSON.parse(content);
      }
    }
  } catch {
    // Fallback to inline translations if file loading fails
  }
  return externalTranslations;
}

export const TRANSLATIONS: Record<Locale, Record<string, string>> = {
  'bn-BD': {
    'app.name': 'ইআরপি পিওএস',
    'nav.dashboard': 'ড্যাশবোর্ড',
    'nav.products': 'পণ্য',
    'nav.inventory': 'ইনভেন্টরি',
    'nav.sales': 'বিক্রয়',
    'nav.purchases': 'ক্রয়',
    'nav.accounting': 'হিসাবনিকাশ',
    'nav.reports': 'প্রতিবেদন',
    'nav.settings': 'সেটিংস',
    'nav.onboarding': 'টেন্যান্ট অনবোর্ডিং',
    'nav.security': 'নিরাপত্তা ইভেন্ট',
    'nav.audit': 'অডিট লগ',
    'nav.system': 'সিস্টেম স্বাস্থ্য',
    'action.login': 'সাইন ইন',
    'action.logout': 'সাইন আউট',
    'action.save': 'সংরক্ষণ',
    'action.cancel': 'বাতিল',
    'action.create': 'তৈরি করুন',
    'action.edit': 'সম্পাদনা',
    'action.delete': 'মুছুন',
    'action.activate': 'সক্রিয় করুন',
    'action.deactivate': 'নিষ্ক্রিয় করুন',
    'label.email': 'ইমেইল',
    'label.password': 'পাসওয়ার্ড',
    'label.company_code': 'কোম্পানি কোড',
    'label.name': 'নাম',
    'label.code': 'কোড',
    'label.status': 'অবস্থা',
    'label.created_at': 'তৈরির তারিখ',
    'label.active': 'সক্রিয়',
    'label.suspended': 'স্থগিত',
    'label.closed': 'বন্ধ',
    'label.feature_flags': 'ফিচার ফ্ল্যাগ',
    'label.tax_codes': 'ট্যাক্স কোড',
    'label.products': 'পণ্যসমূহ',
    'label.categories': 'ক্যাটাগরি',
    'label.brands': 'ব্র্যান্ড',
    'label.units': 'একক',
    'label.barcode': 'বারকোড',
    'label.price': 'মূল্য',
    'label.cost': 'খরচ',
    'label.quantity': 'পরিমাণ',
    'error.required': 'এই ফিল্ডটি আবশ্যক',
    'error.invalid_email': 'অবৈধ ইমেইল ঠিকানা',
    'error.invalid_credentials': 'ভুল প্রমাণপত্র',
    'error.account_locked': 'অ্যাকাউন্ট সাময়িকভাবে লক করা',
    'error.feature_not_enabled': 'এই ফিচারটি সক্রিয় নয়',
    'success.saved': 'সফলভাবে সংরক্ষিত',
    'success.created': 'সফলভাবে তৈরি',
    'success.updated': 'সফলভাবে আপডেট',
    'success.deleted': 'সফলভাবে মুছে ফেলা',
    'currency.BDT': '৳',
    'currency.USD': '$',
    'currency.EUR': '€',
    'date.format': 'dd MMM yyyy',
  },
  'en-BD': {
    'app.name': 'ERP POS',
    'nav.dashboard': 'Dashboard',
    'nav.products': 'Products',
    'nav.inventory': 'Inventory',
    'nav.sales': 'Sales',
    'nav.purchases': 'Purchases',
    'nav.accounting': 'Accounting',
    'nav.reports': 'Reports',
    'nav.settings': 'Settings',
    'nav.onboarding': 'Tenant Onboarding',
    'nav.security': 'Security Events',
    'nav.audit': 'Audit Log',
    'nav.system': 'System Health',
    'action.login': 'Sign In',
    'action.logout': 'Sign Out',
    'action.save': 'Save',
    'action.cancel': 'Cancel',
    'action.create': 'Create',
    'action.edit': 'Edit',
    'action.delete': 'Delete',
    'action.activate': 'Activate',
    'action.deactivate': 'Deactivate',
    'label.email': 'Email',
    'label.password': 'Password',
    'label.company_code': 'Company Code',
    'label.name': 'Name',
    'label.code': 'Code',
    'label.status': 'Status',
    'label.created_at': 'Created At',
    'label.active': 'Active',
    'label.suspended': 'Suspended',
    'label.closed': 'Closed',
    'label.feature_flags': 'Feature Flags',
    'label.tax_codes': 'Tax Codes',
    'label.products': 'Products',
    'label.categories': 'Categories',
    'label.brands': 'Brands',
    'label.units': 'Units',
    'label.barcode': 'Barcode',
    'label.price': 'Price',
    'label.cost': 'Cost',
    'label.quantity': 'Quantity',
    'error.required': 'This field is required',
    'error.invalid_email': 'Invalid email address',
    'error.invalid_credentials': 'Invalid credentials',
    'error.account_locked': 'Account is temporarily locked',
    'error.feature_not_enabled': 'This feature is not enabled',
    'success.saved': 'Saved successfully',
    'success.created': 'Created successfully',
    'success.updated': 'Updated successfully',
    'success.deleted': 'Deleted successfully',
    'currency.BDT': '৳',
    'currency.USD': '$',
    'currency.EUR': '€',
    'date.format': 'dd MMM yyyy',
  },
};

const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Translate a key in the given locale. Falls back to FALLBACK_LOCALE if the
 * key is missing in the requested locale. Loads company overrides from DB
 * (cached per request via the overrides map param).
 */
export function translate(
  key: string,
  locale: Locale = DEFAULT_LOCALE,
  overrides?: Record<string, string>,
): string {
  // 1. Company overrides (highest priority)
  if (overrides && overrides[key]) return overrides[key];
  // 2. External JSON translations (from public/locales/)
  const external = loadExternalTranslations();
  if (external[locale] && key in external[locale]) return external[locale][key];
  // 3. Inline translations (fallback)
  const localeMap = TRANSLATIONS[locale];
  if (localeMap && key in localeMap) return localeMap[key];
  // 4. Fallback locale
  if (external[FALLBACK_LOCALE] && key in external[FALLBACK_LOCALE]) return external[FALLBACK_LOCALE][key];
  return TRANSLATIONS[FALLBACK_LOCALE][key] ?? key;
}

/**
 * Load all translation overrides for a company+locale. Returns a flat map
 * of translationKey → translatedValue.
 */
export async function loadTranslationOverrides(companyId: string, locale: Locale): Promise<Record<string, string>> {
  const rows = await db.translationOverride.findMany({
    where: { companyId, locale },
  });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.translationKey] = r.translatedValue;
  return map;
}

/**
 * Format a date as dd MMM yyyy in the given locale.
 * e.g., bn-BD: "15 জানুয়ারি 2026", en-BD: "15 Jan 2026"
 */
export function formatDate(date: Date | string, locale: Locale = DEFAULT_LOCALE): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = d.getDate();
  const months = locale === 'bn-BD' ? BN_MONTHS : EN_MONTHS;
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * Format a number with locale-aware digits. Stored values are locale-neutral
 * (DECIMAL); only display is localized.
 */
export function formatNumber(value: number | string, locale: Locale = DEFAULT_LOCALE, decimals: number = 2): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (locale === 'bn-BD') {
    // Convert digits to Bengali numerals
    const fixed = n.toFixed(decimals);
    const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    return fixed.replace(/[0-9]/g, d => bnDigits[parseInt(d, 10)]);
  }
  return n.toFixed(decimals);
}

/**
 * Format a monetary amount with currency symbol.
 * e.g., bn-BD: "৳ ১,২৩৪.৫৬", en-BD: "৳ 1,234.56"
 */
export function formatMoney(
  value: number | string,
  currencyCode: string = 'BDT',
  locale: Locale = DEFAULT_LOCALE,
  decimals: number = 2,
): string {
  const symbol = TRANSLATIONS[locale][`currency.${currencyCode}`] ?? currencyCode + ' ';
  const n = typeof value === 'string' ? parseFloat(value) : value;
  const formatted = n.toLocaleString(locale === 'bn-BD' ? 'bn-BD' : 'en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${symbol} ${formatted}`;
}

/**
 * Seed supported_languages + company_languages for a new company during onboarding.
 */
export async function seedLocalizationForCompany(companyId: string, defaultLocale: Locale = DEFAULT_LOCALE): Promise<void> {
  // Ensure supported_languages exist
  for (const locale of SUPPORTED_LOCALES) {
    const meta = locale === 'bn-BD'
      ? { name: 'Bangla (Bangladesh)', nativeName: 'বাংলা', textDirection: 'ltr' }
      : { name: 'English (Bangladesh)', nativeName: 'English', textDirection: 'ltr' };
    await db.supportedLanguage.upsert({
      where: { locale },
      create: { locale, ...meta, isActive: true },
      update: meta,
    });
  }

  // Enable both locales for the company
  for (const locale of SUPPORTED_LOCALES) {
    await db.companyLanguage.upsert({
      where: { companyId_locale: { companyId, locale } },
      create: { companyId, locale, isDefault: locale === defaultLocale, isEnabled: true },
      update: {},
    });
  }
}
