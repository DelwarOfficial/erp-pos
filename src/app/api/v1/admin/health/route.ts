import { NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';
import { getRuntimeHealth } from '@/lib/health/runtime';

export async function GET() {
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'system.config.view');
    const health = await getRuntimeHealth();
    return NextResponse.json(health, { status: health.status === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const status = error instanceof DomainError && [401, 403].includes(error.httpStatus) ? error.httpStatus : 503;
    return NextResponse.json({ error: { code: status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN_SCOPE' : 'HEALTH_UNAVAILABLE',
      message: status === 403 ? 'System Health access denied' : 'Health check unavailable' } },
    { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
