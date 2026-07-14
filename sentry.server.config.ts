// sentry.server.config.ts
// Sentry server-side config — runs in Node.js runtime.
// Per §16 monitoring requirements: error tracking + performance monitoring.

import * as Sentry from '@sentry/nextjs';

export function register() {
  if (!process.env.SENTRY_DSN) {
    console.log('[sentry.server] No SENTRY_DSN — server-side error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.APP_VERSION ? `erp-pos@${process.env.APP_VERSION}` : undefined,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0.1'),
    ignoreErrors: [
      // Common Next.js noise
      'NEXT_NOT_FOUND',
      'NEXT_REDIRECT',
      // Network errors we already handle
      'fetch failed',
      'ECONNRESET',
      'ETIMEDOUT',
    ],
    beforeSend(event) {
      // Strip PII before sending
      if (event.request?.cookies) delete event.request.cookies;
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
      }
      return event;
    },
    integrations: [
      Sentry.httpIntegration(),
      Sentry.prismaIntegration(),
      Sentry.bunIntegration(),
    ],
  });
}

export const onRequestError = Sentry.captureRequestError;
