import { NextRequest } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { listRoles, saveRole } from '@/lib/access/service';
import { accessResponse, accessError } from '@/lib/access/http';
import { computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
export async function GET(req: NextRequest) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'role.read');
    return accessResponse(await listRoles(auth, req.nextUrl.searchParams.get('company_id') || auth.companyId, req.nextUrl.searchParams)); } catch (error) { return accessError(error); }
}
export async function POST(req: NextRequest) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'role.create');
    const body = await req.json();
    const idem = { key: requireIdempotencyKey(req), operation: 'access.role.create', requestHash: computeRequestHash({ method: 'POST', path: '/api/v1/admin/roles', body }) };
    return accessResponse({ data: await saveRole(auth, body, undefined, idem) }, 201); } catch (error) { return accessError(error); }
}
