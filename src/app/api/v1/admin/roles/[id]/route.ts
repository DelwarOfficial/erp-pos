import { NextRequest } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { readRole, saveRole, deleteRole } from '@/lib/access/service';
import { accessResponse, accessError } from '@/lib/access/http';
import { DomainError } from '@/lib/errors/codes';
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
    return accessResponse({ data: await saveRole(auth, await req.json(), (await ctx.params).id) }); } catch (error) { return accessError(error); }
}
export async function DELETE(req: NextRequest, ctx: Context) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'role.update');
    await deleteRole(auth, req.nextUrl.searchParams.get('company_id') || auth.companyId, (await ctx.params).id);
    return accessResponse({ deleted: true }); } catch (error) { return accessError(error); }
}
