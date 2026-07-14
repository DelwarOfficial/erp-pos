// sentry.client.config.ts
// Sentry browser-side config — runs in client bundle.
// Per §16 monitoring requirements.

import * as Sentry from '@sentry/nextjs';

export function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.APP_VERSION ? `erp-pos@${process.env.APP_VERSION}` : undefined,
    tracesSampleRate: parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    replaysSessionSampleRate: parseFloat(process.env.NEXT_PUBLIC_SENTRY_REPLAY_SAMPLE_RATE ?? '0.05'),
    replaysOnErrorSampleRate: 1.0,
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Network request failed',
    ],
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
        maskAllInputs: true,
      }),
      Sentry.browserTracingIntegration(),
    ],
    // Filter sensitive URLs
    beforeSend(event) {
      if (event.request?.url) {
        // Strip query strings that may contain tokens
        event.request.url = event.request.url.split('?')[0];
      }
      return event;
    },
  });
}
