// The screen-copy catalogs (public/locales/*/ui.json) are read by next-intl
// after the flat "a.b.c" keys are nested. These checks keep the two locales
// in step and keep the nesting safe.

import { describe, expect, it } from 'vitest';
import enUi from '../../public/locales/en-BD/ui.json';
import bnUi from '../../public/locales/bn-BD/ui.json';
import enCommon from '../../public/locales/en-BD/common.json';
import { formatDate, formatDateTime, formatMoney, nestMessages } from '../../src/lib/i18n/format';

const en = enUi as Record<string, string>;
const bn = bnUi as Record<string, string>;
const placeholders = (text: string) => (text.match(/\{[a-z_]+/g) ?? []).sort().join(',');

describe('ui catalog', () => {
  it('has the same keys in both locales', () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
  });

  it('keeps every placeholder in the Bengali text', () => {
    const mismatched = Object.keys(en).filter(key => placeholders(en[key]) !== placeholders(bn[key]));
    expect(mismatched).toEqual([]);
  });

  it('has no key that is both a message and a group once nested', () => {
    const keys = [...Object.keys(enCommon), ...Object.keys(en)];
    const all = new Set(keys);
    const collisions = keys.filter(key => key.split('.').slice(0, -1).some((_, i, parts) => all.has(parts.slice(0, i + 1).join('.'))));
    expect(collisions).toEqual([]);
    expect(Object.keys(en).filter(key => key in enCommon)).toEqual([]);
  });

  it('nests flat keys for next-intl', () => {
    expect(nestMessages({ 'a.b.c': 'x', 'a.d': 'y' })).toEqual({ a: { b: { c: 'x' }, d: 'y' } });
  });
});

describe('display formatters', () => {
  it('renders taka with the symbol and lakh grouping', () => {
    expect(formatMoney('125000', 'en-BD')).toBe('৳ 1,25,000.00');
    expect(formatMoney(-50, 'en-BD')).toBe('−৳ 50.00');
    expect(formatMoney('not a number', 'en-BD')).toBe('—');
  });

  it('renders dates and times in Asia/Dhaka whatever the device zone', () => {
    // 18:30 UTC is 00:30 the next day in Dhaka.
    expect(formatDate('2026-11-16T18:30:00.000Z', 'en-BD')).toBe('17 Nov 2026');
    expect(formatDateTime('2026-11-16T18:30:00.000Z', 'en-BD')).toMatch(/^17 Nov 2026, 12:30\s?am$/i);
    expect(formatDate(null, 'en-BD')).toBe('—');
  });
});
