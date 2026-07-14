// src/lib/telemetry/resource.ts
// OpenTelemetry resource attributes for service identification.

export function getResourceAttributes(): Record<string, string> {
  return {
    'service.name': process.env.OTEL_SERVICE_NAME ?? 'erp-pos',
    'service.version': process.env.APP_VERSION ?? '1.0.0',
    'service.namespace': 'erp-pos',
    'service.instance.id': process.env.HOSTNAME ?? `dev-${process.pid}`,
    'deployment.environment': process.env.NODE_ENV ?? 'development',
    'host.name': process.env.HOSTNAME ?? 'localhost',
    'region': process.env.DEPLOY_REGION ?? 'ap-south-1',
  };
}
