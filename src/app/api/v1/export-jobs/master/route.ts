// GET /api/v1/export-jobs/master?entity_type=product[&include_sensitive=true]
//
// Downloads master data (product, customer, supplier, category, unit, brand)
// as CSV in exactly its import template's format, so the file can be edited
// and imported back. The rows are streamed a page at a time.
//
// Sensitive columns (product cost; customer and supplier phone, email,
// address, tax id) are left empty unless include_sensitive=true, which needs
// export.sensitive.company and an MFA check from the last hour.
//
// Behind the same feature flag as imports (import_csv_enabled): the export
// exists to feed the importer.

import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runInTenantContext } from '@/lib/db/transaction';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { requireMfaForAction } from '@/lib/auth/requireMfa';
import { requireFeatureFlag } from '@/lib/featureFlags';
import { DomainError } from '@/lib/errors/codes';
import { generateCsv } from '@/lib/import-export/csv';
import { isMasterExportType, masterExportHeader, masterExportPages, MASTER_EXPORT_TYPES } from '@/lib/import-export/masterExport';
import { errorMeta, logger } from '@/lib/logging';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const entityType = url.searchParams.get('entity_type') ?? '';
  const includeSensitive = url.searchParams.get('include_sensitive') === 'true';

  let auth;
  try {
    auth = await authenticateRequest();
    await requirePermission(auth, 'export.data.branch');
    const ctx = auth.ctx;
    await runInTenantContext(ctx, async () => { await requireFeatureFlag('import_csv_enabled'); });
    if (!isMasterExportType(entityType)) {
      throw new DomainError('VALIDATION_FAILED', `entity_type must be one of: ${MASTER_EXPORT_TYPES.join(', ')}`, {}, 400);
    }
    if (includeSensitive) {
      await requirePermission(auth, 'export.sensitive.company');
      await requireMfaForAction(req, 'sensitive_export');
    }
  } catch (e) {
    if (e instanceof DomainError) {
      return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.httpStatus });
    }
    // Fail closed: a check that could not run is not a pass.
    throw e;
  }
  if (!isMasterExportType(entityType)) throw new Error('unreachable');
  const { ctx, companyId } = auth;
  const userId = auth.userId;
  const scope = <T,>(work: () => Promise<T>) => runInTenantContext(ctx, work);

  const job = await runInTenantContext(ctx, async () => {
    const created = await db.reportExportJob.create({
      data: {
        companyId,
        requestedBy: userId,
        reportCode: `master.${entityType}`,
        format: 'csv',
        filterJson: JSON.stringify({ include_sensitive: includeSensitive }),
        dataCutoffAt: new Date(),
        status: 'running',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    // Who exported what, and whether sensitive columns were included. Never the rows.
    await db.auditLog.create({
      data: {
        companyId, userId, correlationId: randomUUID(),
        action: 'export.master', entityType: 'report_export_job', entityId: created.id,
        afterValue: JSON.stringify({ entity_type: entityType, include_sensitive: includeSensitive }),
      },
    });
    return created;
  });

  const encoder = new TextEncoder();
  const pages = masterExportPages(entityType, companyId, includeSensitive, scope);
  let rowCount = 0;
  const finish = (status: 'completed' | 'failed', summary: string) =>
    runInTenantContext(ctx, async () => { await db.reportExportJob.update({ where: { id: job.id }, data: { status, errorSummary: summary } }); }).catch(() => undefined);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(generateCsv([masterExportHeader(entityType)])));
    },
    async pull(controller) {
      try {
        const next = await pages.next();
        if (next.done) {
          await finish('completed', `Exported ${rowCount} rows`);
          controller.close();
          return;
        }
        rowCount += next.value.length;
        controller.enqueue(encoder.encode(`\n${generateCsv(next.value)}`));
      } catch (e) {
        logger.error('[export-jobs/master] export failed', errorMeta(e));
        await finish('failed', 'Export failed while reading rows');
        controller.error(e);
      }
    },
    async cancel() {
      await pages.return(undefined);
      await finish('failed', `Download cancelled after ${rowCount} rows`);
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${entityType}-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
      'X-Export-Job-Id': job.id,
    },
  });
}
