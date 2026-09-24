// src/lib/telemetry/index.ts
// OpenTelemetry tracing + Sentry error tracking per §1 monitoring requirements.
// The actual OTel SDK is initialized in instrumentation.ts (Node.js startup hook).
// Sentry is initialized by instrumentation.ts (server, edge) and
// instrumentation-client.ts (browser), which load sentry.*.config.ts.

import * as opentelemetry from '@opentelemetry/api';
import * as Sentry from '@sentry/nextjs';

/**
 * Reports whether error tracking is ACTUALLY running in this process.
 *
 * This used to print "Sentry DSN detected — error tracking enabled" whenever
 * SENTRY_DSN was set, which is not the same thing: the Sentry configs were
 * never imported, so the DSN was present and nothing was initialised. It now
 * asks the SDK whether a client exists.
 */
export function isErrorTrackingActive(): boolean {
  return Sentry.getClient() !== undefined;
}

// ── Correlation helpers ──
export function getTraceId(): string | undefined {
  const activeSpan = opentelemetry.trace.getActiveSpan();
  return activeSpan?.spanContext().traceId;
}

export function createSpan<T>(name: string, fn: () => T): T {
  const tracer = opentelemetry.trace.getTracer('erp-pos');
  return tracer.startActiveSpan(name, (span) => {
    try {
      return fn();
    } finally {
      span.end();
    }
  });
}

export async function createAsyncSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const tracer = opentelemetry.trace.getTracer('erp-pos');
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn();
    } finally {
      span.end();
    }
  });
}

// ── Metrics helpers (lightweight wrappers around OTel API) ──
export function incrementCounter(name: string, value = 1, attributes?: Record<string, string>): void {
  // OTel metrics are exported via the PeriodicExportingMetricReader in instrumentation.ts.
  // Direct API access would use opentelemetry.metrics.getMeter(...) — left as a thin wrapper
  // here for use in command handlers that want to count domain events.
  try {
    const meter = opentelemetry.metrics.getMeter('erp-pos');
    const counter = meter.createCounter(name);
    counter.add(value, attributes);
  } catch {
    // Noop — meter provider not initialized (sandbox/dev)
  }
}

export function recordHistogram(name: string, value: number, attributes?: Record<string, string>): void {
  try {
    const meter = opentelemetry.metrics.getMeter('erp-pos');
    const histogram = meter.createHistogram(name);
    histogram.record(value, attributes);
  } catch {
    // Noop
  }
}
