import { NextResponse } from 'next/server';
import { getRuntimeHealth } from '@/lib/health/runtime';

/** Minimal public readiness probe. Detailed dependency information is admin-only. */
export async function GET() {
  try {
    const health = await getRuntimeHealth();
    return NextResponse.json({ status: health.status, service: health.service }, {
      status: health.status === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ status: 'unavailable', service: 'erp-pos' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
