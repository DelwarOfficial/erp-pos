// src/app/api/v1/feature-flags/route.ts
// GET  /api/v1/feature-flags  — list all flags for the company
// PATCH /api/v1/feature-flags/{key}  — toggle a flag (separate file)

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { listFeatureFlags } from '@/lib/featureFlags';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'company.read');
    const flags = await listFeatureFlags(auth.companyId);
    return NextResponse.json({ items: flags });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
