import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { db } from '@/lib/db';
import { runInTenantContext } from '@/lib/db/transaction';
import { accessResponse, accessError } from '@/lib/access/http';
import { NextRequest } from 'next/server';
export async function GET(req: NextRequest) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'company.read');
    const search = req.nextUrl.searchParams.get('search')?.trim();
    return accessResponse({ data: await runInTenantContext(auth.ctx, async () => db.company.findMany({
      where: { ...(!auth.isGlobal ? { id: auth.companyId } : {}), status: 'active', ...(search ? { OR: [{ displayName: { contains: search } }, { code: { contains: search } }] } : {}) }, select: { id: true, displayName: true, code: true },
      take: 100, orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    })) }); } catch (error) { return accessError(error); }
}
