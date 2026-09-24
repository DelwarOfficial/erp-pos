// GET /api/v1/data-subject-requests/[id]/export — everything held about the
// subject of an access or portability request, as a JSON download.
//
// A read, so it is not idempotency-wrapped: the response is the subject's
// personal data and must not be stored in idempotency_requests. What is
// recorded is that an export was produced, when, by whom, its SHA-256 and its
// row counts -- enough to prove what was handed over, without keeping a copy.
// Completing the request is refused until this has happened.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { buildSubjectExport } from '@/lib/compliance/dataSubjectRequests';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'dsr.manage.company');
    const { id } = await params;

    const exported = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async (tx) => {
        const built = await buildSubjectExport(tx, auth.companyId, id);
        await tx.auditLog.create({
          data: {
            companyId: auth.companyId, userId: auth.userId, correlationId,
            action: 'dsr.export_generated', entityType: 'data_subject_request', entityId: id,
            afterValue: JSON.stringify({ sha256: built.sha256, row_counts: built.rowCounts }),
          },
        });
        return built;
      }));

    return new NextResponse(exported.serialised, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="dsr-${id}.json"`,
        'Cache-Control': 'no-store',
        'X-Export-SHA256': exported.sha256,
      },
    });
  } catch (e) { return errorResponse(e, correlationId); }
}
