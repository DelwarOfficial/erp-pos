'use client';

import { ThemeProvider as NextThemeProvider } from 'next-themes';

export function ThemeProvider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  // next-themes writes an inline script to set the theme before paint; it must carry the CSP nonce.
  return <NextThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="erp-theme" nonce={nonce}>{children}</NextThemeProvider>;
}
