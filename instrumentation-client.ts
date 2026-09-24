// instrumentation-client.ts
// Runs in the browser before the application becomes interactive.
//
// Next.js 16 initialises client-side monitoring from this file
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md).
// sentry.client.config.ts exported a register() that nothing called, so
// browser errors were never reported either.

import * as Sentry from '@sentry/nextjs';
import { register } from './sentry.client.config';

try {
  register();
} catch {
  // Monitoring must never be the reason the application fails to load.
}

// Lets Sentry attribute client-side navigations to the right route.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
