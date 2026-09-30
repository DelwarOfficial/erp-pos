import { NextRequest } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { listUsers, saveUser } from '@/lib/access/service';
import { accessResponse, accessError } from '@/lib/access/http';
import { computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
export async function GET(req: NextRequest) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'user.read');
    return accessResponse(await listUsers(auth, req.nextUrl.searchParams)); } catch (error) { return accessError(error); }
}
export async function POST(req: NextRequest) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'user.create');
    await requirePermission(auth, 'role.assign'); await requirePermission(auth, 'user.deactivate');
    const body = await req.json();
    const idem = { key: requireIdempotencyKey(req), operation: 'access.user.create', requestHash: computeRequestHash({ method: 'POST', path: '/api/v1/admin/users', body }) };
    return accessResponse({ data: await saveUser(auth, body, undefined, idem) }, 201); } catch (error) { return accessError(error); }
}
