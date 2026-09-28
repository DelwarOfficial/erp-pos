// POST /api/v1/communications/templates/preview — render a draft text with sample values: the text, encoding and
//      SMS parts, or which placeholders are not allowed. Stores nothing.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { previewTemplate, TEMPLATE_MAX_CHARS } from '@/domain/receivables/templateSettings';

const Body = z.object({ text: z.string().min(1).max(TEMPLATE_MAX_CHARS), locale: z.enum(['bn', 'en']) });

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.template.manage.company');
    requireIdempotencyKey(req); // required on every POST; a preview stores nothing, so it is not recorded
    const body = Body.parse(await req.json());
    return NextResponse.json(previewTemplate(body.text, body.locale));
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', `Text of 1-${TEMPLATE_MAX_CHARS} characters`, { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
