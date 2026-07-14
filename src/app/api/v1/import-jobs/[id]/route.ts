import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';

// GET /api/v1/import-jobs/[id] — get a single import job
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let auth;
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  if ('error' in auth) return NextResponse.json(auth, { status: auth.status });

  const { id } = await params;
  const job = await db.importJob.findFirst({
    where: { id, companyId: auth.companyId },
    include: { _count: { select: { errors: true } } },
  });
  if (!job) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Import job not found' } }, { status: 404 });
  }

  return NextResponse.json({ job });
}
