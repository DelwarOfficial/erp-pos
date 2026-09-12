import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { listPermissions } from '@/lib/access/service';
import { accessResponse, accessError } from '@/lib/access/http';
export async function GET() {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'role.read');
    return accessResponse({ data: await listPermissions(auth) }); } catch (error) { return accessError(error); }
}
