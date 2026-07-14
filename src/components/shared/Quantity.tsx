// src/components/shared/Quantity.tsx
// Locale-aware quantity display. Quantities are DECIMAL(18,4) in storage.

'use client';
import { formatNumber } from '@/lib/i18n';

interface QuantityProps {
  value: number | string;
  locale?: 'bn-BD' | 'en-BD';
  decimals?: number;
  unit?: string;
  className?: string;
}

export function Quantity({ value, locale = 'bn-BD', decimals = 0, unit, className }: QuantityProps) {
  const formatted = formatNumber(value, locale, decimals);
  return <span className={className}>{formatted}{unit ? ` ${unit}` : ''}</span>;
}
