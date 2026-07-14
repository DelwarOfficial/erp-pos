// src/app/(erp)/dashboard/imports/page.tsx
// Import/Export jobs dashboard — per §9.5 + §17.5 UAT Scenario 5.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Upload, Download, FileText, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

interface ImportJob {
  id: string;
  jobType: string;
  fileName: string;
  status: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  committedRows: number | null;
  dryRun: boolean;
  duplicateStrategy: string | null;
  errorCount: number;
  createdAt: string;
  completedAt: string | null;
}

interface ExportJob {
  id: string;
  reportCode: string;
  format: string;
  status: string;
  expiresAt: string;
  errorSummary: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  uploaded: 'bg-gray-100 text-gray-800',
  validating: 'bg-blue-100 text-blue-800',
  invalid: 'bg-red-100 text-red-800',
  ready: 'bg-yellow-100 text-yellow-800',
  importing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  partial: 'bg-orange-100 text-orange-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  expired: 'bg-gray-100 text-gray-800',
};

export default function ImportExportPage() {
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const [importRes, exportRes] = await Promise.all([
        fetch('/api/v1/import-jobs?limit=50'),
        fetch('/api/v1/export-jobs?limit=50'),
      ]);
      if (importRes.ok) {
        const data = await importRes.json();
        setImportJobs(data.jobs ?? []);
      }
      if (exportRes.ok) {
        const data = await exportRes.json();
        setExportJobs(data.jobs ?? []);
      }
    } catch {
      toast.error('Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('job_type', 'product');
      formData.append('dry_run', 'true');
      formData.append('duplicate_strategy', 'skip');

      const res = await fetch('/api/v1/import-jobs', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Import validated: ${data.job.validRows} valid, ${data.job.invalidRows} invalid rows`);
        loadJobs();
      } else {
        toast.error(data?.error?.message ?? 'Upload failed');
      }
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-16">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6" /> Import / Export
        </h1>
        <p className="text-muted-foreground">
          Per §9.5 — versioned templates, staged validation, dry-run, row error download, control totals.
          CSV/Excel exports escape formula-leading cells per §6.8.
        </p>
      </div>

      <Tabs defaultValue="imports">
        <TabsList>
          <TabsTrigger value="imports">Import Jobs ({importJobs.length})</TabsTrigger>
          <TabsTrigger value="exports">Export Jobs ({exportJobs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="imports" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Upload CSV for Import</CardTitle>
              <CardDescription>
                Supports: product, customer, supplier, sale_draft, transfer_draft, purchase, opening_stock.
                Dry-run validation runs automatically. Download row errors for invalid rows.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Button variant="outline" disabled={uploading} onClick={() => document.getElementById('import-file')?.click()}>
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                  {uploading ? 'Uploading...' : 'Upload CSV'}
                </Button>
                <input id="import-file" type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                <span className="text-sm text-muted-foreground">Max 10,000 rows per file</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Import Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              {importJobs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No import jobs yet. Upload a CSV to get started.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Created</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Valid/Total</TableHead>
                      <TableHead className="text-right">Errors</TableHead>
                      <TableHead>Dry Run</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importJobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell className="text-xs">{new Date(job.createdAt).toLocaleString()}</TableCell>
                        <TableCell><Badge variant="outline">{job.jobType}</Badge></TableCell>
                        <TableCell className="text-xs">{job.fileName}</TableCell>
                        <TableCell><Badge className={STATUS_COLORS[job.status] ?? 'bg-gray-100'}>{job.status}</Badge></TableCell>
                        <TableCell className="text-right font-mono text-xs">{job.validRows}/{job.totalRows}</TableCell>
                        <TableCell className="text-right">{job.errorCount > 0 ? <span className="text-red-600">{job.errorCount}</span> : '—'}</TableCell>
                        <TableCell>{job.dryRun ? <Badge variant="secondary">dry-run</Badge> : <Badge variant="outline">live</Badge>}</TableCell>
                        <TableCell>
                          {job.errorCount > 0 && (
                            <Button size="sm" variant="outline" onClick={() => window.open(`/api/v1/import-jobs/${job.id}/errors`, '_blank')}>
                              <Download className="h-3 w-3 mr-1" /> Errors
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="exports" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Create Export</CardTitle>
              <CardDescription>
                Exports respect row scope + sensitive-field permissions (cost/margin/payroll/PII omitted unless authorized).
                CSV exports escape formula-leading cells per §6.8. Exports expire after 7 days.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {['inventory_valuation', 'sales_summary', 'customer_list', 'product_list'].map(code => (
                  <Button key={code} variant="outline" size="sm" onClick={async () => {
                    const res = await fetch('/api/v1/export-jobs', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ report_code: code, format: 'csv', filter_json: {} }),
                    });
                    const data = await res.json();
                    if (res.ok) toast.success(`Export ready: ${data.job.rowCount} rows`);
                    else toast.error(data?.error?.message ?? 'Export failed');
                    loadJobs();
                  }}>
                    <Download className="h-3 w-3 mr-1" /> {code.replace(/_/g, ' ')}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Export Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              {exportJobs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No export jobs yet. Click an export button above.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Created</TableHead>
                      <TableHead>Report</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exportJobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell className="text-xs">{new Date(job.createdAt).toLocaleString()}</TableCell>
                        <TableCell><Badge variant="outline">{job.reportCode}</Badge></TableCell>
                        <TableCell><Badge variant="secondary">{job.format}</Badge></TableCell>
                        <TableCell>
                          {job.status === 'completed' ? <CheckCircle2 className="h-4 w-4 text-green-600" /> :
                           job.status === 'failed' ? <XCircle className="h-4 w-4 text-red-600" /> :
                           job.status === 'expired' ? <AlertCircle className="h-4 w-4 text-gray-400" /> :
                           <Loader2 className="h-4 w-4 animate-spin" />}
                          <span className="ml-1 text-xs">{job.status}</span>
                        </TableCell>
                        <TableCell className="text-xs">{job.expiresAt ? new Date(job.expiresAt).toLocaleDateString() : '—'}</TableCell>
                        <TableCell>
                          {job.status === 'completed' && (
                            <Button size="sm" variant="outline" onClick={() => window.open(`/api/v1/export-jobs/${job.id}/download`, '_blank')}>
                              <Download className="h-3 w-3 mr-1" /> Download
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
