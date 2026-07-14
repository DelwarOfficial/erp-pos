// src/app/(erp)/dashboard/accounting/page.tsx
// Accounting hub — links to journal entries, trial balance, fiscal periods, expenses.

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookOpen, Scale, Calendar, Receipt } from 'lucide-react';

export default function AccountingPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Scale className="h-6 w-6" /> Accounting
        </h1>
        <p className="text-muted-foreground">
          Double-entry ledger, fiscal periods, expenses, and financial reports (Phase M4).
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><BookOpen className="h-5 w-5" /> Journal Entries</CardTitle>
            <CardDescription>Post manual journal entries. Balanced debit/credit enforced.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/accounting/journal"><Button>View Journal →</Button></Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Scale className="h-5 w-5" /> Trial Balance</CardTitle>
            <CardDescription>Account balances computed from posted journal lines.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/accounting/trial-balance"><Button>View Trial Balance →</Button></Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-5 w-5" /> Expenses</CardTitle>
            <CardDescription>Post operational expenses with GL integration.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/accounting/expenses"><Button>View Expenses →</Button></Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Calendar className="h-5 w-5" /> Fiscal Periods</CardTitle>
            <CardDescription>Open/soft-locked/locked periods. Prevents backdated posting.</CardDescription>
          </CardHeader>
          <CardContent>
            <a href="/api/v1/fiscal-periods" target="_blank" className="text-primary hover:underline text-sm">
              View Fiscal Periods API →
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
