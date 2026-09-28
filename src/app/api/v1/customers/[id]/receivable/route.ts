// GET /api/v1/customers/{id}/receivable — what the customer owes, per installment,
// derived from the authoritative records (src/domain/receivables/balances.ts).
// Branch-limited users see the installments of their branches' sales only.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { errorResponse, DomainError } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { installmentBalances } from '@/domain/receivables/balances';
import { isoFromDate, localDate } from '@/domain/receivables/calendar';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'customer.credit.view.branch');
    const { id: customerId } = await params;

    const body = await runInTenantContext(auth.ctx, async () => {
      const customer = await db.customer.findFirst({ where: { id: customerId, companyId: auth.companyId }, select: { id: true, name: true } });
      if (!customer) throw new DomainError('RESOURCE_NOT_FOUND', 'Customer not found', {}, 404);
      const company = await db.company.findFirst({ where: { id: auth.companyId }, select: { timezone: true } });
      const today = localDate(company?.timezone ?? 'Asia/Dhaka');
      const balances = await installmentBalances(db as unknown as Prisma.TransactionClient, auth.companyId, { customerId });
      const open = balances.filter(b => b.outstanding.gt(0));
      const sum = (rows: typeof balances) => rows.reduce((s, b) => s.plus(b.outstanding), new Prisma.Decimal(0)).toFixed(2);
      const overdue = open.filter(b => isoFromDate(b.dueDate) < today);
      return {
        customer,
        as_of: today,
        outstanding: sum(open),
        overdue: sum(overdue),
        next_due: open.find(b => isoFromDate(b.dueDate) >= today)
          ? { due_date: isoFromDate(open.find(b => isoFromDate(b.dueDate) >= today)!.dueDate), amount: open.find(b => isoFromDate(b.dueDate) >= today)!.outstanding.toFixed(2) }
          : null,
        installments: balances.map(b => {
          const due = isoFromDate(b.dueDate);
          return {
            installment_id: b.installmentId, sale_id: b.saleId, sale_reference_no: b.saleReferenceNo, installment_no: b.installmentNo,
            due_date: due, amount: b.amount.toFixed(2), collected: b.collected.toFixed(2), outstanding: b.outstanding.toFixed(2),
            status: b.outstanding.isZero() ? 'paid' : due < today ? 'overdue' : b.collected.gt(0) ? 'partially_paid' : 'pending',
            reminders_enabled: b.remindersEnabled,
          };
        }),
      };
    });
    return NextResponse.json(body);
  } catch (e) { return errorResponse(e, correlationId); }
}
