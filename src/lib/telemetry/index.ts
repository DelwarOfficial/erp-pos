// src/lib/telemetry/index.ts
// OpenTelemetry tracing + Sentry error tracking per §1 monitoring requirements.
// The actual OTel SDK is initialized in instrumentation.ts (Node.js startup hook).
// Sentry is initialized in sentry.{server,client,edge}.config.ts.

import * as opentelemetry from '@opentelemetry/api';

const SENTRY_DSN = process.env.SENTRY_DSN;

/**
 * Light init — the real SDK bootstrap happens in instrumentation.ts and
 * sentry.*.config.ts (auto-loaded by Next.js). This function exists so that
 * the worker process can call it as a sanity check on startup.
 */
export function initTelemetry(): void {
  if (SENTRY_DSN) {
    console.log('[telemetry] Sentry DSN detected — error tracking enabled');
  } else {
    console.log('[telemetry] No SENTRY_DSN — error tracking disabled (development mode)');
  }
  console.log('[telemetry] OpenTelemetry API available — tracing initialized via instrumentation.ts');
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
