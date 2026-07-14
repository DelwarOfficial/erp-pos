// src/app/(erp)/dashboard/reports/page.tsx
// Report catalog — grid of report cards grouped by category.
// Consumes: GET /api/v1/reports/[code] (via "Run Report" button), POST /api/v1/export-jobs (Export CSV / PDF).
// Report codes mirror the catalogue in src/reports/index.ts (REPORTS registry).

'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileBarChart, Play, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';

type Category = 'Sales' | 'Inventory' | 'Accounting' | 'Tax' | 'HR' | 'Service' | 'Delivery';

interface ReportEntry {
  code: string;
  title: string;
  description: string;
  category: Category;
}

const REPORT_CATALOG: ReportEntry[] = [
  // Sales
  { code: 'sales_summary', title: 'Sales Summary', description: 'Aggregated sales totals for a date range.', category: 'Sales' },
  { code: 'daily_sales', title: 'Daily Sales', description: 'Day-by-day sales totals and counts.', category: 'Sales' },
  { code: 'monthly_sales', title: 'Monthly Sales', description: 'Month-by-month sales totals and counts.', category: 'Sales' },
  { code: 'best_seller', title: 'Best Sellers', description: 'Top-selling products by quantity and revenue.', category: 'Sales' },
  { code: 'sales_objective', title: 'Sales Objectives', description: 'Progress against configured sales targets.', category: 'Sales' },
  { code: 'dashboard_summary', title: 'Dashboard Summary', description: 'Headline KPIs for the dashboard.', category: 'Sales' },

  // Inventory
  { code: 'inventory_valuation', title: 'Inventory Valuation', description: 'Stock on hand valued at moving average cost.', category: 'Inventory' },
  { code: 'product_inventory', title: 'Product Inventory', description: 'Per-product stock positions across warehouses.', category: 'Inventory' },
  { code: 'inventory_ledger', title: 'Inventory Ledger', description: 'In/out movement history per product.', category: 'Inventory' },
  { code: 'stock_alert', title: 'Stock Alert', description: 'Products at or below reorder point.', category: 'Inventory' },
  { code: 'stock_count_variance', title: 'Stock Count Variance', description: 'Variance between counted and system stock.', category: 'Inventory' },
  { code: 'serial_history', title: 'Serial History', description: 'Lifecycle history of serialized units.', category: 'Inventory' },
  { code: 'batch_expiry', title: 'Batch Expiry', description: 'Batches approaching expiry.', category: 'Inventory' },
  { code: 'daily_purchases', title: 'Daily Purchases', description: 'Day-by-day purchase totals.', category: 'Inventory' },
  { code: 'monthly_purchases', title: 'Monthly Purchases', description: 'Month-by-month purchase totals.', category: 'Inventory' },

  // Accounting
  { code: 'trial_balance', title: 'Trial Balance', description: 'Account balances computed from posted journal lines.', category: 'Accounting' },
  { code: 'profit_and_loss', title: 'Profit & Loss', description: 'Income statement for a date range.', category: 'Accounting' },
  { code: 'balance_sheet', title: 'Balance Sheet', description: 'Assets, liabilities, and equity as of a date.', category: 'Accounting' },
  { code: 'cash_flow', title: 'Cash Flow', description: 'Cash inflows and outflows for a date range.', category: 'Accounting' },
  { code: 'ar_aging', title: 'AR Aging', description: 'Outstanding receivables grouped by age bucket.', category: 'Accounting' },
  { code: 'ap_aging', title: 'AP Aging', description: 'Outstanding payables grouped by age bucket.', category: 'Accounting' },
  { code: 'customer_ledger', title: 'Customer Ledger', description: 'Per-customer ledger entries.', category: 'Accounting' },
  { code: 'supplier_ledger', title: 'Supplier Ledger', description: 'Per-supplier ledger entries.', category: 'Accounting' },
  { code: 'expense_report', title: 'Expense Report', description: 'Expenses grouped by category and date.', category: 'Accounting' },
  { code: 'installment_due', title: 'Installment Due', description: 'Installment schedule due dates.', category: 'Accounting' },

  // Tax
  { code: 'tax_summary', title: 'Tax Summary', description: 'Tax collected/payable by component.', category: 'Tax' },

  // Delivery
  { code: 'delivery_status', title: 'Delivery Status', description: 'Delivery order status breakdown.', category: 'Delivery' },
  { code: 'courier_cod_reconciliation', title: 'Courier COD Reconciliation', description: 'COD remittance reconciliation per courier.', category: 'Delivery' },
];

const CATEGORY_ORDER: Category[] = ['Sales', 'Inventory', 'Accounting', 'Tax', 'HR', 'Service', 'Delivery'];

const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  Sales: 'Revenue, best-sellers, and targets.',
  Inventory: 'Stock, valuation, movements, and expiry.',
  Accounting: 'Ledger, P&L, balance sheet, and aging.',
  Tax: 'VAT and statutory tax summaries.',
  HR: 'Payroll and workforce reports.',
  Service: 'Service requests and warranty work.',
  Delivery: 'Shipments and courier reconciliation.',
};

interface ExportJobResponse {
  job?: {
    id: string;
    reportCode: string;
    format: string;
    status: string;
    rowCount?: number;
  };
  downloadUrl?: string;
  error?: { code?: string; message?: string };
}

export default function ReportsPage() {
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [loading] = useState(false);
  const [error] = useState<string | null>(null);

  const runReport = useCallback((code: string) => {
    try {
      window.open(`/api/v1/reports/${code}`, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to open report');
    }
  }, []);

  const exportReport = useCallback(async (code: string, format: 'csv' | 'pdf') => {
    const key = `${code}-${format}`;
    setExportingKey(key);
    try {
      const idempotencyKey = `report-export-${key}-${Date.now()}`;
      const res = await fetch('/api/v1/export-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ report_code: code, format, filter_json: {} }),
      });
      const data: ExportJobResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error?.message ?? `Export failed (HTTP ${res.status})`);
        return;
      }
      if (data.downloadUrl) {
        toast.success(`${format.toUpperCase()} export ready - ${data.job?.rowCount ?? 0} rows`);
        try {
          window.open(data.downloadUrl, '_blank', 'noopener,noreferrer');
        } catch {
          /* download URL opened via toast */
        }
      } else {
        toast.success(`${format.toUpperCase()} export queued`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setExportingKey(null);
    }
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileBarChart className="h-6 w-6" /> Reports
          </h1>
          <p className="text-muted-foreground">
            Browse the report catalogue. Run a report inline or export to CSV/PDF.
          </p>
        </div>
        <Badge variant="outline" className="self-start">{REPORT_CATALOG.length} reports</Badge>
      </div>

      {loading ? (
        <Card>
          <CardContent><LoadingState label="Loading reports..." /></CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent><ErrorState message={error} /></CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {CATEGORY_ORDER.map(category => {
            const reports = REPORT_CATALOG.filter(r => r.category === category);
            return (
              <section key={category} className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{category}</h2>
                    <p className="text-xs text-muted-foreground">{CATEGORY_DESCRIPTIONS[category]}</p>
                  </div>
                  <Badge variant="secondary">{reports.length}</Badge>
                </div>
                {reports.length === 0 ? (
                  <Card>
                    <CardContent>
                      <EmptyState
                        icon={<FileBarChart className="h-8 w-8 text-muted-foreground/50" />}
                        message={`No ${category.toLowerCase()} reports are available in the catalogue yet.`}
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {reports.map(r => {
                      const busyCsv = exportingKey === `${r.code}-csv`;
                      const busyPdf = exportingKey === `${r.code}-pdf`;
                      return (
                        <Card key={r.code} className="flex flex-col">
                          <CardHeader>
                            <CardTitle className="text-base">{r.title}</CardTitle>
                            <CardDescription className="text-xs">{r.description}</CardDescription>
                          </CardHeader>
                          <CardContent className="flex-1 space-y-2 mt-auto">
                            <div className="text-xs font-mono text-muted-foreground">{r.code}</div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => runReport(r.code)}
                                className="min-h-[36px]"
                              >
                                <Play className="h-3 w-3 mr-1" /> Run Report
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => exportReport(r.code, 'csv')}
                                disabled={busyCsv}
                                className="min-h-[36px]"
                              >
                                {busyCsv ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileSpreadsheet className="h-3 w-3 mr-1" />}
                                CSV
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => exportReport(r.code, 'pdf')}
                                disabled={busyPdf}
                                className="min-h-[36px]"
                              >
                                {busyPdf ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileText className="h-3 w-3 mr-1" />}
                                PDF
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> About Exports
          </CardTitle>
          <CardDescription>
            Exports respect row scope and sensitive-field permissions (cost/margin/payroll/PII omitted unless authorized).
            CSV exports escape formula-leading cells. Export jobs expire after 7 days.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
