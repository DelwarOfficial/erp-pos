import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { db } from '@/lib/db';
import { runInTenantContext } from '@/lib/db/transaction';
import { accessResponse, accessError } from '@/lib/access/http';
export async function GET() {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'company.read');
    return accessResponse({ data: await runInTenantContext(auth.ctx, async () => db.company.findMany({
      where: { ...(!auth.isGlobal ? { id: auth.companyId } : {}), status: 'active' }, select: { id: true, displayName: true, code: true },
      take: 100, orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    })) }); } catch (error) { return accessError(error); }
}
