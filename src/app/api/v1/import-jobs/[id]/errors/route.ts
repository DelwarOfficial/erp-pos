import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runInTenantContext } from '@/lib/db/transaction';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';
import { generateCsv } from '@/lib/import-export/csv';

// GET /api/v1/import-jobs/[id]/errors — download row-level errors as CSV

const ERROR_PAGE = 1_000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let auth;
  try {
    auth = await authenticateRequest();
    await requirePermission(auth, 'import.execute.company');
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  

  const { id } = await params;
  const job = await runInTenantContext(auth.ctx, async () => {
    return db.importJob.findFirst({
      where: { id, companyId: auth.companyId },
      select: { id: true, fileName: true, jobType: true },
    });
  });
  if (!job) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Import job not found' } }, { status: 404 });
  }

  // Streamed in keyset pages. This read every error of the job in one query
  // and built the whole CSV in memory; an import has no row limit, so neither
  // did this. The file is byte-for-byte what it was, a page at a time.
  const headers = ['row_number', 'column_name', 'error_code', 'error_message', 'raw_row'];
  const ctx = auth.ctx;
  let cursor: string | undefined;
  const encoder = new TextEncoder();
  const csv = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(generateCsv([headers])));
    },
    async pull(controller) {
      const errors = await runInTenantContext(ctx, async () => db.importJobError.findMany({
        where: { importJobId: id },
        orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }],
        take: ERROR_PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }));
      if (errors.length > 0) {
        const rows = errors.map(e => [
          String(e.rowNumber),
          e.columnName ?? '',
          e.errorCode ?? '',
          e.errorMessage,
          e.rawRow ?? '',
        ]);
        controller.enqueue(encoder.encode(`\n${generateCsv(rows)}`));
        cursor = errors[errors.length - 1].id;
      }
      if (errors.length < ERROR_PAGE) controller.close();
    },
  });

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="import-errors-${job.fileName}.csv"`,
    },
  });
}
