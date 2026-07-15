import { NextRequest, NextResponse } from 'next/server';
import { requireIdempotencyKey } from "@/lib/idempotency";
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';
import { getTemplate } from '@/lib/import-export/templates';
import { validateImport } from '@/lib/import-export/importProcessor';
import crypto from 'node:crypto';

// GET /api/v1/import-jobs — list import jobs for the current company
export async function GET(req: NextRequest) {
  let auth;
    const idempotencyKey = requireIdempotencyKey(req);
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  

  try {
    await requirePermission(auth, 'import.execute.company');
  } catch (e) {
    if (e instanceof DomainError && !auth.isGlobal) {
      return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    }
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const jobType = url.searchParams.get('job_type');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const where: Record<string, unknown> = { companyId: auth.companyId };
  if (status) where.status = status;
  if (jobType) where.jobType = jobType;

  const [jobs, total] = await Promise.all([
    db.importJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { _count: { select: { errors: true } } },
    }),
    db.importJob.count({ where }),
  ]);

  return NextResponse.json({
    jobs: jobs.map(j => ({
      id: j.id,
      jobType: j.jobType,
      fileName: j.fileName,
      status: j.status,
      totalRows: j.totalRows,
      validRows: j.validRows,
      invalidRows: j.invalidRows,
      committedRows: j.committedRows,
      dryRun: j.dryRun,
      duplicateStrategy: j.duplicateStrategy,
      errorCount: j._count.errors,
      createdBy: j.createdBy,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
    })),
    total,
    limit,
    offset,
  });
}

// POST /api/v1/import-jobs — upload a CSV file for import
// Body (multipart/form-data): file=<csv>, job_type=<product|customer|...>, dry_run=<true|false>, duplicate_strategy=<skip|update|fail>
export async function POST(req: NextRequest) {
  let auth;
    const idempotencyKey = requireIdempotencyKey(req);
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  

  try {
    await requirePermission(auth, 'import.execute.company');
  } catch (e) {
    if (e instanceof DomainError && !auth.isGlobal) {
      return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    }
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const jobType = formData.get('job_type') as string;
    const dryRun = formData.get('dry_run') === 'true';
    const duplicateStrategy = (formData.get('duplicate_strategy') as string) || 'skip';

    if (!file) {
      return NextResponse.json({ error: { code: 'VALIDATION_FAILED', message: 'File is required' } }, { status: 400 });
    }
    if (!jobType) {
      return NextResponse.json({ error: { code: 'VALIDATION_FAILED', message: 'job_type is required' } }, { status: 400 });
    }

    const template = getTemplate(jobType);
    if (!template) {
      return NextResponse.json({
        error: { code: 'VALIDATION_FAILED', message: `Unknown job_type: ${jobType}. Valid types: ${Object.keys(getTemplate).join(', ')}` },
      }, { status: 400 });
    }

    // Read file content
    const csvContent = await file.text();
    const fileSha256 = crypto.createHash('sha256').update(csvContent).digest('hex');

    // Create import job
    const job = await db.importJob.create({
      data: {
        companyId: auth.companyId,
        jobType,
        fileName: file.name,
        objectKey: `imports/${auth.companyId}/${Date.now()}-${file.name}`,
        fileSha256,
        status: 'validating',
        dryRun,
        duplicateStrategy,
        createdBy: auth.userId ?? 'unknown',
      },
    });

    // Run validation
    const result = await validateImport(job.id, auth.companyId, csvContent, template);

    return NextResponse.json({
      job: {
        id: job.id,
        jobType,
        fileName: file.name,
        fileSha256,
        status: result.invalidRows === 0 ? 'ready' : (result.validRows > 0 ? 'ready' : 'invalid'),
        totalRows: result.totalRows,
        validRows: result.validRows,
        invalidRows: result.invalidRows,
        dryRun,
        duplicateStrategy,
        controlTotals: result.controlTotals,
        errorCount: result.errors.length,
      },
      message: result.invalidRows === 0
        ? `Validation passed: ${result.validRows} rows ready to import`
        : `Validation found ${result.invalidRows} invalid rows out of ${result.totalRows}. Download errors for details.`,
    }, { status: 201 });
  } catch (e) {
    console.error('[import-jobs] POST failed:', e);
    return NextResponse.json({ error: { code: 'INTERNAL', message: e instanceof Error ? e.message : 'Unknown' } }, { status: 500 });
  }
}
