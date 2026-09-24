// Error tracking for the worker process.
//
// Workers run as `bun src/workers/index.ts`, entirely outside Next.js, so
// neither instrumentation.ts nor any sentry.*.config.ts is ever loaded there.
// Failures in reconciliation, retention, outbox delivery and communication
// campaigns produced a line of JSON on stdout and nothing else: no alert, no
// grouping, no trace. The nightly reconciliation could fail every night
// unnoticed.
//
// @sentry/node rather than @sentry/nextjs: this process has no Next runtime.

import * as Sentry from '@sentry/node';

let initialised = false;

export function initWorkerErrorTracking(): boolean {
  if (initialised) return true;
  if (!process.env.SENTRY_DSN) return false;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.APP_VERSION ? `erp-pos@${process.env.APP_VERSION}` : undefined,
    serverName: 'erp-pos-worker',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    // Same scrubbing as the web process: the worker handles webhook secrets
    // and customer data, so request headers must never leave the host.
    beforeSend(event) {
      if (event.request?.cookies) delete event.request.cookies;
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
      }
      return event;
    },
  });
  initialised = true;
  return true;
}

/** Report a failed job with enough context to find it again. */
export function captureJobFailure(queue: string, jobId: string | undefined, error: unknown): void {
  if (!initialised) return;
  Sentry.withScope(scope => {
    scope.setTag('queue', queue);
    if (jobId) scope.setTag('job_id', jobId);
    scope.setContext('job', { queue, jobId });
    Sentry.captureException(error);
  });
}

/** Flush before exit so a crash's last report is not lost with the process. */
export async function flushWorkerErrorTracking(timeoutMs = 2000): Promise<void> {
  if (initialised) await Sentry.flush(timeoutMs);
}
