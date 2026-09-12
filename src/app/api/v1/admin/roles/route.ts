import { NextRequest } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { listRoles, saveRole } from '@/lib/access/service';
import { accessResponse, accessError } from '@/lib/access/http';
export async function GET(req: NextRequest) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'role.read');
    return accessResponse(await listRoles(auth, req.nextUrl.searchParams.get('company_id') || auth.companyId, req.nextUrl.searchParams)); } catch (error) { return accessError(error); }
}
export async function POST(req: NextRequest) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'role.create');
    return accessResponse({ data: await saveRole(auth, await req.json()) }, 201); } catch (error) { return accessError(error); }
}
