// instrumentation.ts
// Next.js 16 instrumentation hook — runs once on server startup.
// Initializes OpenTelemetry tracing (OTLP exporter) per §1 + §16 monitoring requirements.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
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
    }

    // Register shutdown hooks
    process.on('SIGTERM', () => {
      sdk.shutdown().then(() => console.log('[instrumentation] OTel SDK shut down cleanly'));
    });
  }
}
