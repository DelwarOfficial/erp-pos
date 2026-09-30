import { NextRequest } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { readRole, saveRole, deleteRole } from '@/lib/access/service';
import { accessResponse, accessError } from '@/lib/access/http';
import { DomainError } from '@/lib/errors/codes';
import { computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, ctx: Context) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'role.read');
    const id = (await ctx.params).id;
    const data = await readRole(auth, req.nextUrl.searchParams.get('company_id') || auth.companyId, id);
    if (!data) throw new DomainError('RESOURCE_NOT_FOUND', 'Role not found', {}, 404);
    return accessResponse({ data }); } catch (error) { return accessError(error); }
}
export async function PATCH(req: NextRequest, ctx: Context) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'role.update');
    const id = (await ctx.params).id; const body = await req.json();
    const idem = { key: requireIdempotencyKey(req), operation: 'access.role.update', requestHash: computeRequestHash({ method: 'PATCH', path: `/api/v1/admin/roles/${id}`, body }) };
    return accessResponse({ data: await saveRole(auth, body, id, idem) }); } catch (error) { return accessError(error); }
}
export async function DELETE(req: NextRequest, ctx: Context) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'role.update');
    const id = (await ctx.params).id; const companyId = req.nextUrl.searchParams.get('company_id') || auth.companyId;
    const idem = { key: requireIdempotencyKey(req), operation: 'access.role.delete', requestHash: computeRequestHash({ method: 'DELETE', path: `/api/v1/admin/roles/${id}`, body: { company_id: companyId } }) };
    await deleteRole(auth, companyId, id, idem);
    return accessResponse({ deleted: true }); } catch (error) { return accessError(error); }
}
