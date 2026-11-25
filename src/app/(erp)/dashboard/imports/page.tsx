// src/app/(erp)/dashboard/imports/page.tsx
// Import/Export jobs dashboard — per §9.5 + §17.5 UAT Scenario 5.
//
// The whole import flow: pick a file type, download its template, upload
// (the server validates every row), download the row errors, then import a
// job that is ready. Master data can also be exported in its import format,
// edited, and imported back.

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Upload, Download, FileText, AlertCircle, CheckCircle2, XCircle, Play } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api/client';
import { FeatureOffError, FeatureOffNotice, throwIfFeatureOff } from '@/components/shared/FeatureOff';
import { generateCsv } from '@/lib/import-export/csv';
import { IMPORT_TEMPLATES, MAX_IMPORT_ROWS, getTemplate, getTemplateDemoRow, getTemplateHeader } from '@/lib/import-export/templates';
import { MASTER_EXPORT_TYPES } from '@/lib/import-export/masterExport.client';

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
  uploaded: 'bg-muted text-muted-foreground',
  validating: 'bg-info text-info-foreground',
  invalid: 'bg-destructive/10 text-destructive',
  ready: 'bg-warning text-warning-foreground',
  importing: 'bg-info text-info-foreground',
  completed: 'bg-success text-success-foreground',
  partial: 'bg-warning text-warning-foreground',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
  running: 'bg-info text-info-foreground',
  expired: 'bg-muted text-muted-foreground',
};

const JOB_TYPES = Object.keys(IMPORT_TEMPLATES);
const REPORT_CODES = ['inventory_valuation', 'sales_summary', 'customer_list', 'product_list'];

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** The file name from a Content-Disposition header, else the fallback. */
function dispositionName(header: string | null, fallback: string) {
  return /filename="([^"]+)"/.exec(header ?? '')?.[1] ?? fallback;
}

export default function ImportExportPage() {
  const t = useTranslations('imports');
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [importsOff, setImportsOff] = useState(false);
  const [jobType, setJobType] = useState('product');
  const [strategy, setStrategy] = useState('skip');
  const [dryRun, setDryRun] = useState(false);
  const [committing, setCommitting] = useState<string | null>(null);
  const [exportType, setExportType] = useState<string>('product');
  const [exportSensitive, setExportSensitive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // The commit must send the same file again (the server checks its SHA-256
  // against the validated one), so each file uploaded in this visit is kept
  // here, in the browser only, keyed by its job. A job uploaded in an earlier
  // visit is imported by uploading its file again.
  const uploadedFiles = useRef(new Map<string, File>());
  const [heldJobIds, setHeldJobIds] = useState<ReadonlySet<string>>(new Set());

  const template = getTemplate(jobType)!;
  const strategies = template.allowedDuplicateStrategies;

  const loadJobs = useCallback(async () => {
    try {
      const [importRes, exportRes] = await Promise.all([
        apiFetch('/api/v1/import-jobs?limit=50'),
        apiFetch('/api/v1/export-jobs?limit=50'),
      ]);
      if (importRes.ok) {
        const data = await importRes.json();
        setImportJobs(data.jobs ?? []);
      } else {
        try { throwIfFeatureOff(await importRes.json()); } catch (e) { if (e instanceof FeatureOffError) setImportsOff(true); }
      }
      if (exportRes.ok) {
        const data = await exportRes.json();
        setExportJobs(data.jobs ?? []);
      }
    } catch {
      toast.error(t('err_load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  function chooseJobType(next: string) {
    setJobType(next);
    if (!getTemplate(next)!.allowedDuplicateStrategies.includes(strategy)) setStrategy('skip');
  }

  function downloadTemplate() {
    // Built from the server's own template definition, never typed in here.
    const csv = generateCsv([getTemplateHeader(jobType)!, getTemplateDemoRow(jobType)!], { escapeFormulas: false });
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${jobType}-template.csv`);
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('job_type', jobType);
      formData.append('dry_run', String(dryRun));
      formData.append('duplicate_strategy', strategy);

      const res = await apiFetch('/api/v1/import-jobs', {
        method: 'POST', body: formData,
        headers: { 'Idempotency-Key': `import-upload-${crypto.randomUUID()}` },
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        uploadedFiles.current.set(data.job.id, file);
        setHeldJobIds(new Set(uploadedFiles.current.keys()));
        if (data.job.invalidRows > 0) toast.warning(t('validated_with_errors', { valid: data.job.validRows, invalid: data.job.invalidRows }));
        else toast.success(t(dryRun ? 'validated_dry' : 'validated', { valid: data.job.validRows }));
        await loadJobs();
      } else {
        toast.error(t('err_upload', { reason: data?.error?.message ?? t('err_generic') }));
      }
    } catch {
      toast.error(t('err_network'));
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  async function commitJob(job: ImportJob) {
    const file = uploadedFiles.current.get(job.id);
    if (!file) return;
    setCommitting(job.id);
    try {
      const res = await apiFetch(`/api/v1/import-jobs/${job.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `import-commit-${job.id}` },
        body: JSON.stringify({ csvContent: await file.text() }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        uploadedFiles.current.delete(job.id);
        setHeldJobIds(new Set(uploadedFiles.current.keys()));
        const counts = { committed: data.committedRows, skipped: data.skippedRows, failed: data.failedRows };
        if (data.failedRows > 0) toast.warning(t('commit_partial', counts));
        else toast.success(t('commit_done', counts));
      } else {
        toast.error(t('err_commit', { reason: data?.error?.message ?? t('err_generic') }));
      }
      await loadJobs();
    } catch {
      toast.error(t('err_network'));
    } finally {
      setCommitting(null);
    }
  }

  async function exportMaster() {
    setExporting(true);
    try {
      // apiFetch asks for an authenticator code when sensitive columns need one, then retries.
      const res = await apiFetch(`/api/v1/export-jobs/master?entity_type=${exportType}&include_sensitive=${exportSensitive}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(t('err_export', { reason: data?.error?.message ?? t('err_generic') }));
        return;
      }
      saveBlob(await res.blob(), dispositionName(res.headers.get('Content-Disposition'), `${exportType}-export.csv`));
      toast.success(t('export_done'));
      await loadJobs();
    } catch {
      toast.error(t('err_network'));
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-16" role="status" aria-label={t('loading')}>
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6" aria-hidden="true" /> {t('title')}
        </h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      {importsOff ? <FeatureOffNotice module={t('feature_name')} /> : null}

      <Tabs defaultValue="imports">
        <TabsList>
          <TabsTrigger value="imports">{t('tab_imports', { count: importJobs.length })}</TabsTrigger>
          <TabsTrigger value="exports">{t('tab_exports', { count: exportJobs.length })}</TabsTrigger>
        </TabsList>

        <TabsContent value="imports" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('upload_title')}</CardTitle>
              <CardDescription>{t('upload_desc', { max: MAX_IMPORT_ROWS.toLocaleString() })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="import-type">{t('job_type')}</Label>
                  <Select value={jobType} onValueChange={chooseJobType}>
                    <SelectTrigger id="import-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {JOB_TYPES.map(type => <SelectItem key={type} value={type}>{t(`type.${type}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="import-strategy">{t('strategy')}</Label>
                  <Select value={strategy} onValueChange={setStrategy}>
                    <SelectTrigger id="import-strategy"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {strategies.map(s => <SelectItem key={s} value={s}>{t(`strategy_${s}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-2 pb-2">
                  <Checkbox id="import-dry-run" checked={dryRun} onCheckedChange={v => setDryRun(v === true)} />
                  <Label htmlFor="import-dry-run" className="font-normal">{t('dry_run')}</Label>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{t(`type_help.${jobType}`)}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={downloadTemplate}>
                  <Download className="h-4 w-4 mr-2" aria-hidden="true" /> {t('download_template')}
                </Button>
                <Button disabled={uploading || importsOff} onClick={() => fileInput.current?.click()}>
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> : <Upload className="h-4 w-4 mr-2" aria-hidden="true" />}
                  {uploading ? t('uploading') : t('upload')}
                </Button>
                <input ref={fileInput} id="import-file" type="file" accept=".csv,text/csv" onChange={handleFileUpload} className="hidden" aria-label={t('upload')} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('jobs_title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {importJobs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">{t('jobs_empty')}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('col_created')}</TableHead>
                      <TableHead>{t('col_type')}</TableHead>
                      <TableHead>{t('col_file')}</TableHead>
                      <TableHead>{t('col_status')}</TableHead>
                      <TableHead className="text-right">{t('col_valid')}</TableHead>
                      <TableHead className="text-right">{t('col_imported')}</TableHead>
                      <TableHead className="text-right">{t('col_errors')}</TableHead>
                      <TableHead><span className="sr-only">{t('col_actions')}</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importJobs.map((job) => {
                      const held = heldJobIds.has(job.id);
                      const committable = job.status === 'ready' && !job.dryRun;
                      return (
                        <TableRow key={job.id}>
                          <TableCell className="text-xs">{new Date(job.createdAt).toLocaleString()}</TableCell>
                          <TableCell><Badge variant="outline">{IMPORT_TEMPLATES[job.jobType] ? t(`type.${job.jobType}`) : job.jobType}</Badge></TableCell>
                          <TableCell className="text-xs">{job.fileName}</TableCell>
                          <TableCell>
                            <Badge className={STATUS_COLORS[job.status] ?? 'bg-muted'}>{t.has(`status.${job.status}`) ? t(`status.${job.status}`) : job.status}</Badge>
                            {job.dryRun && <Badge variant="secondary" className="ml-1.5">{t('dry_run_badge')}</Badge>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">{job.validRows}/{job.totalRows}</TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">{job.committedRows ?? '—'}</TableCell>
                          <TableCell className="text-right">{job.errorCount > 0 ? <span className="text-destructive">{job.errorCount}</span> : '—'}</TableCell>
                          <TableCell className="whitespace-nowrap space-x-1.5 text-right">
                            {committable && held && (
                              <Button size="sm" disabled={committing === job.id} onClick={() => commitJob(job)} aria-label={t('commit_named', { file: job.fileName })}>
                                {committing === job.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" aria-hidden="true" /> : <Play className="h-3 w-3 mr-1" aria-hidden="true" />}
                                {t('commit')}
                              </Button>
                            )}
                            {committable && !held && <span className="text-xs text-muted-foreground">{t('commit_reupload')}</span>}
                            {job.errorCount > 0 && (
                              <Button size="sm" variant="outline" onClick={() => window.open(`/api/v1/import-jobs/${job.id}/errors`, '_blank')}
                                aria-label={t('errors_named', { file: job.fileName })}>
                                <Download className="h-3 w-3 mr-1" aria-hidden="true" /> {t('errors')}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="exports" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('master_title')}</CardTitle>
              <CardDescription>{t('master_desc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="export-type">{t('job_type')}</Label>
                <Select value={exportType} onValueChange={setExportType}>
                  <SelectTrigger id="export-type" className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MASTER_EXPORT_TYPES.map(type => <SelectItem key={type} value={type}>{t(`type.${type}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox id="export-sensitive" checked={exportSensitive} onCheckedChange={v => setExportSensitive(v === true)} />
                <Label htmlFor="export-sensitive" className="font-normal">{t('include_sensitive')}</Label>
              </div>
              <Button disabled={exporting || importsOff} onClick={exportMaster}>
                {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4 mr-2" aria-hidden="true" />}
                {t('export_csv')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('report_title')}</CardTitle>
              <CardDescription>{t('report_desc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {REPORT_CODES.map(code => (
                  <Button key={code} variant="outline" size="sm" onClick={async () => {
                    const res = await apiFetch('/api/v1/export-jobs', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `report-export-${crypto.randomUUID()}` },
                      body: JSON.stringify({ report_code: code, format: 'csv', filter_json: {} }),
                    });
                    const data = await res.json().catch(() => null);
                    if (res.ok) toast.success(t('report_ready', { rows: data.job.rowCount }));
                    else toast.error(t('err_export', { reason: data?.error?.message ?? t('err_generic') }));
                    loadJobs();
                  }}>
                    <Download className="h-3 w-3 mr-1" aria-hidden="true" /> {t(`report.${code}`)}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('export_jobs_title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {exportJobs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">{t('export_jobs_empty')}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('col_created')}</TableHead>
                      <TableHead>{t('col_report')}</TableHead>
                      <TableHead>{t('col_format')}</TableHead>
                      <TableHead>{t('col_status')}</TableHead>
                      <TableHead>{t('col_expires')}</TableHead>
                      <TableHead><span className="sr-only">{t('col_actions')}</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exportJobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell className="text-xs">{new Date(job.createdAt).toLocaleString()}</TableCell>
                        <TableCell><Badge variant="outline">{job.reportCode}</Badge></TableCell>
                        <TableCell><Badge variant="secondary">{job.format}</Badge></TableCell>
                        <TableCell>
                          {job.status === 'completed' ? <CheckCircle2 className="h-4 w-4 text-success-foreground inline" aria-hidden="true" /> :
                           job.status === 'failed' ? <XCircle className="h-4 w-4 text-destructive inline" aria-hidden="true" /> :
                           job.status === 'expired' ? <AlertCircle className="h-4 w-4 text-muted-foreground inline" aria-hidden="true" /> :
                           <Loader2 className="h-4 w-4 animate-spin inline" aria-hidden="true" />}
                          <span className="ml-1 text-xs">{t.has(`status.${job.status}`) ? t(`status.${job.status}`) : job.status}</span>
                        </TableCell>
                        <TableCell className="text-xs">{job.expiresAt ? new Date(job.expiresAt).toLocaleDateString() : '—'}</TableCell>
                        <TableCell>
                          {/* Master exports download straight away; only report exports can be downloaded again. */}
                          {job.status === 'completed' && !job.reportCode.startsWith('master.') && (
                            <Button size="sm" variant="outline" onClick={() => window.open(`/api/v1/export-jobs/${job.id}/download`, '_blank')}>
                              <Download className="h-3 w-3 mr-1" aria-hidden="true" /> {t('download')}
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
