import { NextRequest } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { listUsers, saveUser } from '@/lib/access/service';
import { accessResponse, accessError } from '@/lib/access/http';
export async function GET(req: NextRequest) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'user.read');
    return accessResponse(await listUsers(auth, req.nextUrl.searchParams)); } catch (error) { return accessError(error); }
}
export async function POST(req: NextRequest) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'user.create');
    await requirePermission(auth, 'role.assign'); await requirePermission(auth, 'user.deactivate');
    return accessResponse({ data: await saveUser(auth, await req.json()) }, 201); } catch (error) { return accessError(error); }
}
