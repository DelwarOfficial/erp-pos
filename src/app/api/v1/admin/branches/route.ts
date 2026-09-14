import { NextRequest } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { db } from '@/lib/db';
import { runInTenantContext } from '@/lib/db/transaction';
import { assertCompanyScope } from '@/lib/access/policy';
import { accessResponse, accessError } from '@/lib/access/http';
export async function GET(req: NextRequest) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'branch.read');
    const companyId = req.nextUrl.searchParams.get('company_id') || auth.companyId; assertCompanyScope(auth, companyId);
    const search = req.nextUrl.searchParams.get('search')?.trim();
    return accessResponse({ data: await runInTenantContext(auth.ctx, async () => db.branch.findMany({
      where: { companyId, isActive: true, ...(search ? { OR: [{ name: { contains: search } }, { code: { contains: search } }] } : {}), ...(!auth.isGlobal && auth.accessScope !== 'global' ? { id: { in: auth.branchIds } } : {}) },
      select: { id: true, name: true, code: true }, take: 100, orderBy: [{ name: 'asc' }, { id: 'asc' }],
    })) }); } catch (error) { return accessError(error); }
}
