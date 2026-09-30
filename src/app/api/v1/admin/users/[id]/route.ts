import { NextRequest } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { readUser, saveUser } from '@/lib/access/service';
import { accessResponse, accessError } from '@/lib/access/http';
import { computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, ctx: Context) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'user.read');
    return accessResponse({ data: await readUser(auth, req.nextUrl.searchParams.get('company_id') || auth.companyId, (await ctx.params).id) });
  } catch (error) { return accessError(error); }
}
export async function PATCH(req: NextRequest, ctx: Context) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'user.update');
    await requirePermission(auth, 'role.assign'); await requirePermission(auth, 'user.deactivate');
    const id = (await ctx.params).id; const body = await req.json();
    const idem = { key: requireIdempotencyKey(req), operation: 'access.user.update', requestHash: computeRequestHash({ method: 'PATCH', path: `/api/v1/admin/users/${id}`, body }) };
    return accessResponse({ data: await saveUser(auth, body, id, idem) }); } catch (error) { return accessError(error); }
}
