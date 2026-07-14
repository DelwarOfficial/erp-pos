// src/components/shared/Money.tsx
// Locale-aware money formatter per §20.D19. Displays BDT with ৳ symbol.
// Stored values are locale-neutral DECIMAL — only display is localized.

'use client';
import { formatMoney } from '@/lib/i18n';

interface MoneyProps {
  value: number | string;
  currency?: string;
  locale?: 'bn-BD' | 'en-BD';
  decimals?: number;
  className?: string;
}

export function Money({ value, currency = 'BDT', locale = 'bn-BD', decimals = 2, className }: MoneyProps) {
  return <span className={className}>{formatMoney(value, currency, locale, decimals)}</span>;
}
