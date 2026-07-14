// sentry.edge.config.ts
// Sentry Edge runtime config — runs in Edge Functions (Vercel/Cloudflare).

import * as Sentry from '@sentry/nextjs';

export function register() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    ignoreErrors: ['NEXT_NOT_FOUND', 'NEXT_REDIRECT'],
  });
}

export const onRequestError = Sentry.captureRequestError;
