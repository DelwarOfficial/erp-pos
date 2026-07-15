import { NextRequest, NextResponse } from 'next/server';
import { requireIdempotencyKey } from "@/lib/idempotency";
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';
import { getTemplate } from '@/lib/import-export/templates';
import { commitImport } from '@/lib/import-export/importProcessor';

// POST /api/v1/import-jobs/[id]/commit — commit a validated import job
// Actually inserts/updates records. Sale/transfer imports create drafts only.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let auth;
    const idempotencyKey = requireIdempotencyKey(req);
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  

  try {
    await requirePermission(auth, 'import.approve.company');
  } catch (e) {
    if (e instanceof DomainError && !auth.isGlobal) {
      return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    }
  }

  const { id } = await params;
  const job = await db.importJob.findFirst({
    where: { id, companyId: auth.companyId },
  });
  if (!job) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Import job not found' } }, { status: 404 });
  }

  // Can only commit jobs in 'ready' status
  if (job.status !== 'ready') {
    return NextResponse.json({
      error: {
        code: 'INVALID_STATUS',
        message: `Cannot commit job with status '${job.status}'. Job must be in 'ready' status (run validation first).`,
      },
    }, { status: 409 });
  }

  const template = getTemplate(job.jobType);
  if (!template) {
    return NextResponse.json({ error: { code: 'VALIDATION_FAILED', message: `Unknown job type: ${job.jobType}` } }, { status: 400 });
  }

  // For the commit, we need the CSV content — in production this would be
  // re-downloaded from S3. For sandbox, we accept it in the request body.
  const body = await req.json().catch(() => ({}));
  const csvContent = body.csvContent;
  if (!csvContent) {
    return NextResponse.json({
      error: { code: 'VALIDATION_FAILED', message: 'csvContent is required in the request body (production: re-download from S3)' },
    }, { status: 400 });
  }

  const result = await commitImport(
    id,
    auth.companyId,
    auth.userId ?? 'unknown',
    csvContent,
    template,
    job.duplicateStrategy ?? 'skip',
  );

  return NextResponse.json({
    jobId: id,
    status: result.failedRows === 0 ? 'completed' : (result.committedRows > 0 ? 'partial' : 'failed'),
    committedRows: result.committedRows,
    skippedRows: result.skippedRows,
    failedRows: result.failedRows,
  });
}
