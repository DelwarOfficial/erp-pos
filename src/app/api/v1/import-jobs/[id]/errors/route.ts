import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';
import { generateCsv } from '@/lib/import-export/csv';

// GET /api/v1/import-jobs/[id]/errors — download row-level errors as CSV
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let auth;
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  

  const { id } = await params;
  const job = await db.importJob.findFirst({
    where: { id, companyId: auth.companyId },
    select: { id: true, fileName: true, jobType: true },
  });
  if (!job) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Import job not found' } }, { status: 404 });
  }

  const errors = await db.importJobError.findMany({
    where: { importJobId: id },
    orderBy: { rowNumber: 'asc' },
  });

  // Generate CSV with error details
  const headers = ['row_number', 'column_name', 'error_code', 'error_message', 'raw_row'];
  const rows = errors.map(e => [
    String(e.rowNumber),
    e.columnName ?? '',
    e.errorCode ?? '',
    e.errorMessage,
    e.rawRow ?? '',
  ]);

  const csv = generateCsv([headers, ...rows]);

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="import-errors-${job.fileName}.csv"`,
    },
  });
}
