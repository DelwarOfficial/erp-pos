// F-64 / F-65 regression: errors must actually reach Sentry.
//
// F-64  sentry.server.config.ts and sentry.edge.config.ts exported register()
//       and onRequestError, and nothing imported either. Next.js loads those
//       hooks from instrumentation.ts only, so Sentry.init() never ran and no
//       server error was reported -- while a log line said tracking was on.
// F-65  the worker runs outside Next.js entirely, so no Sentry config was
//       loaded there either. Job failures were a line of JSON on stdout.
//
// These tests assert the wiring, not Sentry's delivery: that init is called on
// the right runtime, that Next's hook is the SDK's capture function, and that a
// failed job is handed to captureException with enough context to find it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureRequestError: vi.fn(),
  withScope: vi.fn(),
  flush: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  init: sentry.init,
  captureException: sentry.captureException,
  captureRequestError: sentry.captureRequestError,
  httpIntegration: () => ({}),
  prismaIntegration: () => ({}),
}));
vi.mock('@sentry/node', () => ({
  init: sentry.init,
  captureException: sentry.captureException,
  withScope: sentry.withScope,
  flush: sentry.flush,
}));
// The OTel bootstrap is not under test here and needs a live collector.
vi.mock('@opentelemetry/sdk-node', () => ({ NodeSDK: class { start() {} shutdown() { return Promise.resolve(); } } }));
vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({ OTLPTraceExporter: class {} }));
vi.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({ OTLPMetricExporter: class {} }));
vi.mock('@opentelemetry/sdk-trace-base', () => ({ BatchSpanProcessor: class {} }));
vi.mock('@opentelemetry/sdk-metrics', () => ({ PeriodicExportingMetricReader: class {} }));
vi.mock('@/lib/telemetry/resource', () => ({ getResourceAttributes: () => ({}) }));

describe('F-64: server error tracking is initialised by instrumentation.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.SENTRY_DSN = 'https://public@example.invalid/1';
  });

  it('initialises Sentry on the Node.js runtime', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const { register } = await import('../../instrumentation');
    await register();

    // The decisive assertion: before the fix this was never called.
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init.mock.calls[0][0].dsn).toBe('https://public@example.invalid/1');
  });

  it('initialises Sentry on the Edge runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const { register } = await import('../../instrumentation');
    await register();
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });

  it('exports onRequestError from the file Next.js actually reads', async () => {
    const instrumentation = await import('../../instrumentation');
    // Next looks for this export here and nowhere else. It used to live in
    // sentry.server.config.ts, where it was never called.
    expect(instrumentation.onRequestError).toBe(sentry.captureRequestError);
  });

  it('keeps Sentry from installing a second OpenTelemetry tracer provider', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const { register } = await import('../../instrumentation');
    await register();
    // instrumentation.ts runs its own NodeSDK. Two providers cannot both be
    // global, so spans would silently go to whichever registered last.
    expect(sentry.init.mock.calls[0][0].skipOpenTelemetrySetup).toBe(true);
  });

  it('scrubs credentials before sending', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const { register } = await import('../../instrumentation');
    await register();
    const beforeSend = sentry.init.mock.calls[0][0].beforeSend;
    const event = beforeSend({
      request: { cookies: { session: 'x' }, headers: { authorization: 'Bearer x', cookie: 'y', accept: '*/*' } },
    });
    expect(event.request.cookies).toBeUndefined();
    expect(event.request.headers.authorization).toBeUndefined();
    expect(event.request.headers.cookie).toBeUndefined();
    expect(event.request.headers.accept).toBe('*/*');
  });

  it('does nothing when no DSN is configured', async () => {
    delete process.env.SENTRY_DSN;
    process.env.NEXT_RUNTIME = 'nodejs';
    const { register } = await import('../../instrumentation');
    await register();
    expect(sentry.init).not.toHaveBeenCalled();
  });
});

describe('F-64: browser error tracking is initialised by instrumentation-client.ts', () => {
  it('calls the client config register() at module load', () => {
    const source = readFileSync('instrumentation-client.ts', 'utf8');
    // The client config exported a register() that nothing called.
    expect(source).toMatch(/import \{ register \} from '\.\/sentry\.client\.config'/);
    expect(source).toMatch(/^\s*register\(\);/m);
  });
});

describe('F-65: worker failures reach Sentry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sentry.withScope.mockImplementation((fn: (scope: unknown) => void) =>
      fn({ setTag: sentry.setTag, setContext: sentry.setContext }));
  });

  it('initialises tracking in the worker process', async () => {
    process.env.SENTRY_DSN = 'https://public@example.invalid/1';
    const { initWorkerErrorTracking } = await import('@/workers/sentry');
    expect(initWorkerErrorTracking()).toBe(true);
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init.mock.calls[0][0].serverName).toBe('erp-pos-worker');
  });

  it('reports a failed job tagged with its queue and job id', async () => {
    process.env.SENTRY_DSN = 'https://public@example.invalid/1';
    const { initWorkerErrorTracking, captureJobFailure } = await import('@/workers/sentry');
    initWorkerErrorTracking();

    const failure = new Error('reconciliation check failed');
    captureJobFailure('reconciliation', 'job-42', failure);

    expect(sentry.captureException).toHaveBeenCalledWith(failure);
    expect(sentry.setTag).toHaveBeenCalledWith('queue', 'reconciliation');
    expect(sentry.setTag).toHaveBeenCalledWith('job_id', 'job-42');
  });

  it('wires captureJobFailure into every worker failure handler', () => {
    const source = readFileSync('src/workers/index.ts', 'utf8');
    for (const queue of ['OUTBOX', 'COMMUNICATION', 'RECONCILIATION', 'EXPIRE_RESERVATIONS', 'RETENTION']) {
      expect(source, `${queue} failure handler does not report`)
        .toMatch(new RegExp(`captureJobFailure\\(QUEUE_NAMES\\.${queue}`));
    }
  });

  it('is inert without a DSN rather than failing', async () => {
    delete process.env.SENTRY_DSN;
    const { initWorkerErrorTracking, captureJobFailure } = await import('@/workers/sentry');
    expect(initWorkerErrorTracking()).toBe(false);
    captureJobFailure('outbox', 'job-1', new Error('x'));
    expect(sentry.captureException).not.toHaveBeenCalled();
  });
});
