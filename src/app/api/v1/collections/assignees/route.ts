// GET /api/v1/collections/assignees — active users of the company a follow-up can be assigned to: id and name only,
//     for users who manage follow-ups but may not read the user directory.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.manage.branch');
    const users = await runInTenantContext(auth.ctx, () => db.user.findMany({
      where: { companyId: auth.companyId, isActive: true }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 500,
    }));
    return NextResponse.json({ items: users });
  } catch (e) { return errorResponse(e, correlationId); }
}
