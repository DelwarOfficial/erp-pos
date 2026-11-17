// POST /api/v1/purchases/{id}/invoice — post the supplier's invoice for goods received.
// Moves the received value out of GRNI into the supplier's payable; see
// src/domain/commands/m2/PostSupplierInvoice.ts.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postSupplierInvoice } from '@/domain/commands/m2/PostSupplierInvoice';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const Money = z.string().regex(/^\d{1,15}(\.\d{1,2})?$/, 'An amount with at most two decimal places, as a string');
const InvoiceSchema = z.object({
  supplier_invoice_no: z.string().min(1).max(100),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  amount: Money,
  tax_amount: Money.optional(),
  input_tax_component_id: z.string().uuid().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'purchase.create');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = InvoiceSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/purchases/${id}/invoice`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async tx =>
        withIdempotency(
          { idempotencyKey, operation: 'purchase.invoice', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const posted = await postSupplierInvoice(tx, {
              companyId: auth.companyId, purchaseId: id, supplierInvoiceNo: body.supplier_invoice_no,
              invoiceDate: new Date(`${body.invoice_date}T00:00:00Z`), amount: body.amount, taxAmount: body.tax_amount,
              inputTaxComponentId: body.input_tax_component_id, postedBy: auth.userId,
            }, correlationId);
            return {
              status: 201,
              body: { purchase_id: posted.purchaseId, journal_entry_id: posted.journalEntryId,
                received_value: posted.receivedValue, invoice_amount_base: posted.invoiceBase, price_variance: posted.variance },
              resourceType: 'purchase', resourceId: id,
            };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid supplier invoice', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
