import { NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { issuePasswordReset } from '@/lib/access/reset';
import { accessResponse, accessError } from '@/lib/access/http';
// No Idempotency-Key (F-12, deliberate): issuing a reset invalidates every
// earlier unused link for the user, so a retry cannot leave two live links,
// and storing the response for replay would keep a live reset token in the
// database.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try { const auth = await authenticateRequest(); await requirePermission(auth, 'user.reset_password');
    const body = z.object({ company_id: z.string().uuid() }).strict().parse(await req.json());
    return accessResponse(await issuePasswordReset(auth, body.company_id, (await ctx.params).id));
  } catch (error) { return accessError(error); }
}
