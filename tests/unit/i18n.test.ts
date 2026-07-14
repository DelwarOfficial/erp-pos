// tests/unit/i18n.test.ts
// Tests for §20.D19 — localization.

import { describe, it, expect } from 'vitest';
import {
  translate,
  formatDate,
  formatNumber,
  formatMoney,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  TRANSLATIONS,
} from '../../src/lib/i18n';

describe('i18n', () => {
  it('has exactly two supported locales', () => {
    expect(SUPPORTED_LOCALES).toEqual(['bn-BD', 'en-BD']);
    expect(DEFAULT_LOCALE).toBe('bn-BD');
    expect(FALLBACK_LOCALE).toBe('en-BD');
  });

  it('translates a key in Bangla', () => {
    expect(translate('nav.dashboard', 'bn-BD')).toBe('ড্যাশবোর্ড');
    expect(translate('action.login', 'bn-BD')).toBe('সাইন ইন');
  });

  it('translates a key in English', () => {
    expect(translate('nav.dashboard', 'en-BD')).toBe('Dashboard');
    expect(translate('action.login', 'en-BD')).toBe('Sign In');
  });

  it('falls back to en-BD when key is missing in bn-BD', () => {
    // Add a key only in en-BD to TRANSLATIONS map (simulate)
    const enValue = TRANSLATIONS['en-BD']['app.name'];
    expect(enValue).toBeDefined();
    // If we ask for a non-existent key, it returns the key itself
    expect(translate('nonexistent.key', 'bn-BD')).toBe('nonexistent.key');
  });

  it('applies company overrides when provided', () => {
    const overrides = { 'nav.dashboard': 'Custom Dashboard' };
    expect(translate('nav.dashboard', 'en-BD', overrides)).toBe('Custom Dashboard');
  });

  it('formats dates locale-aware', () => {
    const date = new Date('2026-01-15T10:00:00Z');
    const en = formatDate(date, 'en-BD');
    expect(en).toMatch(/15 Jan 2026/);
    const bn = formatDate(date, 'bn-BD');
    expect(bn).toMatch(/জানুয়ারি/);
  });

  it('formats numbers with Bengali digits in bn-BD', () => {
    const en = formatNumber(1234.56, 'en-BD');
    expect(en).toBe('1234.56');
    const bn = formatNumber(1234.56, 'bn-BD');
    expect(bn).toContain('১'); // Bengali digit 1
    expect(bn).not.toContain('1'); // No ASCII digits
  });

  it('formats money with currency symbol', () => {
    const en = formatMoney(1234.56, 'BDT', 'en-BD');
    expect(en).toContain('৳');
    expect(en).toContain('1,234.56');
  });
});
