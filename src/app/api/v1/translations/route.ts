// src/app/api/v1/translations/route.ts
// GET /api/v1/translations?locale=bn-BD
// Returns the translation map for the requested locale + company overrides.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/middleware';
import { translate, loadTranslationOverrides, SUPPORTED_LOCALES, Locale, DEFAULT_LOCALE } from '@/lib/i18n';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

// Re-export the core translation keys so the client can iterate them.
// (The TRANSLATIONS map is internal to the i18n module; we expose a helper.)
import { TRANSLATIONS } from '@/lib/i18n';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const locale = (req.nextUrl.searchParams.get('locale') ?? DEFAULT_LOCALE) as Locale;
    if (!SUPPORTED_LOCALES.includes(locale)) {
      throw new DomainError('VALIDATION_FAILED', `Unsupported locale: ${locale}`, { supported: SUPPORTED_LOCALES }, 400);
    }

    const overrides = await loadTranslationOverrides(auth.companyId, locale);
    const keys = Object.keys(TRANSLATIONS[locale] ?? TRANSLATIONS[DEFAULT_LOCALE]);
    const map: Record<string, string> = {};
    for (const k of keys) {
      map[k] = translate(k, locale, overrides);
    }

    return NextResponse.json({
      locale,
      fallback_locale: 'en-BD',
      translations: map,
      override_count: Object.keys(overrides).length,
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}

// Re-export for TypeScript
export { };
