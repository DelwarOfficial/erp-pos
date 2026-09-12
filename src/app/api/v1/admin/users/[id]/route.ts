import { NextRequest } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { readUser, saveUser } from '@/lib/access/service';
import { accessResponse, accessError } from '@/lib/access/http';
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, ctx: Context) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'user.read');
    return accessResponse({ data: await readUser(auth, req.nextUrl.searchParams.get('company_id') || auth.companyId, (await ctx.params).id) });
  } catch (error) { return accessError(error); }
}
export async function PATCH(req: NextRequest, ctx: Context) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'user.update');
    await requirePermission(auth, 'role.assign'); await requirePermission(auth, 'user.deactivate');
    return accessResponse({ data: await saveUser(auth, await req.json(), (await ctx.params).id) }); } catch (error) { return accessError(error); }
}
