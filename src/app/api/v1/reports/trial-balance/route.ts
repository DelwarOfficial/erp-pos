// GET /api/v1/reports/trial-balance
// Computes trial balance from posted journal lines.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'report.execute');
    const url = req.nextUrl;
    const asOf = url.searchParams.get('as_of') ? new Date(url.searchParams.get('as_of')!) : new Date();

    // Get all posted journal lines up to as_of
    const lines = await db.journalLine.findMany({
      where: {
        companyId: auth.companyId,
        journalEntry: {
          status: 'posted',
          entryDate: { lte: asOf },
        },
      },
      include: {
        chartOfAccount: { select: { id: true, code: true, name: true, accountClass: true, normalBalance: true } },
      },
    });

    // Aggregate by account
    const accountMap = new Map<string, {
      code: string; name: string; accountClass: string; normalBalance: string;
      totalDebit: number; totalCredit: number;
    }>();

    for (const line of lines) {
      const coa = line.chartOfAccount;
      if (!accountMap.has(coa.id)) {
        accountMap.set(coa.id, {
          code: coa.code, name: coa.name, accountClass: coa.accountClass, normalBalance: coa.normalBalance,
          totalDebit: 0, totalCredit: 0,
        });
      }
      const acct = accountMap.get(coa.id)!;
      acct.totalDebit += parseFloat(line.debitBase.toString());
      acct.totalCredit += parseFloat(line.creditBase.toString());
    }

    // Compute balance per account (normal balance determines sign)
    const items = Array.from(accountMap.entries()).map(([id, a]) => {
      const balance = a.normalBalance === 'D'
        ? a.totalDebit - a.totalCredit
        : a.totalCredit - a.totalDebit;
      return {
        account_id: id,
        code: a.code, name: a.name,
        account_class: a.accountClass, normal_balance: a.normalBalance,
        total_debit: a.totalDebit.toFixed(2),
        total_credit: a.totalCredit.toFixed(2),
        balance: balance.toFixed(2),
        balance_type: balance >= 0 ? (a.normalBalance === 'D' ? 'Debit' : 'Credit') : (a.normalBalance === 'D' ? 'Credit' : 'Debit'),
      };
    }).sort((a, b) => a.code.localeCompare(b.code));

    const grandTotalDebit = items.reduce((s, i) => s + (i.balance_type === 'Debit' ? parseFloat(i.balance) : 0), 0);
    const grandTotalCredit = items.reduce((s, i) => s + (i.balance_type === 'Credit' ? parseFloat(i.balance) : 0), 0);

    return NextResponse.json({
      as_of: asOf.toISOString(),
      accounts: items,
      summary: {
        total_accounts: items.length,
        total_debit: grandTotalDebit.toFixed(2),
        total_credit: grandTotalCredit.toFixed(2),
        is_balanced: Math.abs(grandTotalDebit - grandTotalCredit) < 0.01,
      },
    });
  } catch (e) { return errorResponse(e, correlationId); }
}
