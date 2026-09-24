// instrumentation.ts
// Next.js 16 instrumentation hook — runs once on server startup.
//
// Next.js loads `register` and `onRequestError` from THIS file only
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
// Sentry was previously configured in sentry.server.config.ts and
// sentry.edge.config.ts, each exporting its own register() and onRequestError,
// and nothing imported either file -- so Sentry.init() never ran and no server
// error was ever reported, while a log line claimed tracking was enabled.

import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Sentry first, so an error during OTel bootstrap is itself reported.
    const { register: registerSentry } = await import('./sentry.server.config');
    registerSentry();

    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http');
    const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
    const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics');
    const { getResourceAttributes } = await import('@/lib/telemetry/resource');

    const traceExporter = new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
    });
    const metricExporter = new OTLPMetricExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/metrics',
    });

    const sdk = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'erp-pos',
      ...(getResourceAttributes() as Record<string, string>),
      spanProcessor: new BatchSpanProcessor(traceExporter),
      metricReader: new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 30_000,
      }),
    });

    try {
      sdk.start();
      console.log('[instrumentation] OpenTelemetry SDK started');
    } catch (e) {
      console.error('[instrumentation] Failed to start OTel SDK:', e);
      Sentry.captureException(e);
    }

    process.on('SIGTERM', () => {
      sdk.shutdown().then(() => console.log('[instrumentation] OTel SDK shut down cleanly'));
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    const { register: registerSentryEdge } = await import('./sentry.edge.config');
    registerSentryEdge();
  }
}

// Next.js calls this for every server error it captures: route handlers,
// server components, server actions and middleware.
export const onRequestError = Sentry.captureRequestError;
