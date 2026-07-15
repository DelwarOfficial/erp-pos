import { NextRequest, NextResponse } from 'next/server';
import { requireIdempotencyKey } from "@/lib/idempotency";
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/errors/codes';
import { generateMushak61, generateMushak63, generateMushak91, generateWithholdingCertificate } from '@/lib/tax/statutoryDocuments';

// POST /api/v1/statutory-documents/generate
// Generates Mushak 6.1/6.2/6.3/9.1 or withholding certificates.
// Body: { document_type, source_type, source_id, period_start?, period_end? }
export async function POST(req: NextRequest) {
  let auth;
    const idempotencyKey = requireIdempotencyKey(req);
  try {
    auth = await authenticateRequest();
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
  

  try {
    await requirePermission(auth, 'tax.generate.company');
  } catch (e) {
    if (e instanceof DomainError && !auth.isGlobal) {
      return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    }
  }

  const body = await req.json().catch(() => ({}));
  const { document_type, source_type, source_id, period_start, period_end } = body;

  if (!document_type || !source_type || !source_id) {
    return NextResponse.json({
      error: { code: 'VALIDATION_FAILED', message: 'document_type, source_type, and source_id are required' },
    }, { status: 400 });
  }

  try {
    let result;

    switch (document_type) {
      case 'VAT_6_1':
        if (source_type !== 'sale') throw new DomainError('VALIDATION_FAILED', 'VAT_6_1 requires source_type=sale', {}, 400);
        result = await generateMushak61(auth.companyId, source_id, auth.userId ?? 'system');
        break;

      case 'VAT_6_3':
        if (source_type !== 'sale_return') throw new DomainError('VALIDATION_FAILED', 'VAT_6_3 requires source_type=sale_return', {}, 400);
        result = await generateMushak63(auth.companyId, source_id, auth.userId ?? 'system');
        break;

      case 'VAT_9_1':
        if (!period_start || !period_end) throw new DomainError('VALIDATION_FAILED', 'VAT_9_1 requires period_start and period_end', {}, 400);
        result = await generateMushak91(auth.companyId, new Date(period_start), new Date(period_end), auth.userId ?? 'system');
        break;

      case 'withholding_certificate':
        if (source_type !== 'payment') throw new DomainError('VALIDATION_FAILED', 'withholding_certificate requires source_type=payment', {}, 400);
        result = await generateWithholdingCertificate(auth.companyId, source_id, auth.userId ?? 'system');
        break;

      default:
        return NextResponse.json({
          error: { code: 'VALIDATION_FAILED', message: `Unknown document_type: ${document_type}. Valid: VAT_6_1, VAT_6_3, VAT_9_1, withholding_certificate` },
        }, { status: 400 });
    }

    return NextResponse.json({ document: result }, { status: 201 });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    return NextResponse.json({ error: { code: 'INTERNAL', message: e instanceof Error ? e.message : 'Unknown' } }, { status: 500 });
  }
}
