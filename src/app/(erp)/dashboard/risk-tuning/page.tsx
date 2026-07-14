// src/app/(erp)/dashboard/risk-tuning/page.tsx
// Risk Threshold Tuning Dashboard — per §20.D15 + Step 3 follow-up.
// Shows: current thresholds, recent assessments, FP/FN report with charts,
// and outcome recorder for individual assessments.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Loader2, ShieldAlert, TrendingUp, TrendingDown, Activity, Target, AlertCircle, Lightbulb, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

// ── Types ──
interface RiskConfig {
  [key: string]: number;
}

interface RiskAssessment {
  id: string;
  providerCode: string;
  subjectType: string;
  subjectId: string;
  score: number | null;
  decision: string;
  reasonCodes: string[];
  providerReference: string | null;
  assessedAt: string;
  expiresAt: string;
  outcomes: Array<{
    id: string;
    outcomeType: string;
    outcomeAmount: string | null;
    recordedAt: string;
  }>;
}

interface RiskReport {
  period: { from: string; to: string };
  summary: {
    totalAssessments: number;
    withOutcomes: number;
    pendingReview: number;
    truePositives: number;
    trueNegatives: number;
    falsePositives: number;
    falseNegatives: number;
    precision: number | null;
    recall: number | null;
    lossAmount: { falseNegatives: number; truePositives: number };
  };
  byReasonCode: Array<{
    reasonCode: string;
    count: number;
    fp: number;
    fn: number;
    tp: number;
    tn: number;
    falsePositiveRate: number | null;
    falseNegativeRate: number | null;
  }>;
  thresholdChanges?: Array<{
    id: string;
    thresholdKey: string;
    oldValue: string | null;
    newValue: string;
    reason: string | null;
    changedBy: string;
    changedAt: string;
  }>;
  recommendations: string[];
}

const DECISION_COLORS: Record<string, string> = {
  allow: 'bg-green-100 text-green-800',
  review: 'bg-yellow-100 text-yellow-800',
  block: 'bg-red-100 text-red-800',
  unavailable: 'bg-gray-100 text-gray-800',
};

const OUTCOME_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  no_issue: 'bg-green-100 text-green-800',
  returned: 'bg-yellow-100 text-yellow-800',
  charged_back: 'bg-red-100 text-red-800',
  refunded: 'bg-orange-100 text-orange-800',
  fraud_confirmed: 'bg-red-100 text-red-800',
};

const PIE_COLORS = ['#10b981', '#22c55e', '#ef4444', '#f97316']; // TP, TN, FP, FN

export default function RiskTuningPage() {
  const [config, setConfig] = useState<RiskConfig | null>(null);
  const [assessments, setAssessments] = useState<RiskAssessment[]>([]);
  const [report, setReport] = useState<RiskReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [configRes, assessRes, reportRes] = await Promise.all([
        fetch('/api/v1/admin/risk-config'),
        fetch('/api/v1/admin/risk-assessments?limit=50'),
        fetch('/api/v1/admin/risk-assessments/report'),
      ]);

      if (configRes.ok) {
        const configData = await configRes.json();
        setConfig(configData.config);
      }
      if (assessRes.ok) {
        const assessData = await assessRes.json();
        setAssessments(assessData.assessments ?? []);
      }
      if (reportRes.ok) {
        const reportData = await reportRes.json();
        setReport(reportData);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load risk data');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-16">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6" /> Risk Threshold Tuning
          </h1>
          <p className="text-muted-foreground">
            Per §20.D15 — monitor false-positive / false-negative rates and tune scoring thresholds.
          </p>
        </div>
        <Button variant="outline" onClick={loadAll} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="report">
        <TabsList>
          <TabsTrigger value="report"><Activity className="h-4 w-4 mr-2" />FP/FN Report</TabsTrigger>
          <TabsTrigger value="assessments"><Target className="h-4 w-4 mr-2" />Assessments ({assessments.length})</TabsTrigger>
          <TabsTrigger value="thresholds"><TrendingUp className="h-4 w-4 mr-2" />Current Thresholds</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: FP/FN Report ── */}
        <TabsContent value="report" className="space-y-6">
          {report && <ReportView report={report} />}
        </TabsContent>

        {/* ── Tab 2: Recent Assessments ── */}
        <TabsContent value="assessments" className="space-y-6">
          <AssessmentsTable assessments={assessments} onOutcomeRecorded={loadAll} />
        </TabsContent>

        {/* ── Tab 3: Current Thresholds ── */}
        <TabsContent value="thresholds" className="space-y-6">
          {config && <ThresholdsView config={config} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// FP/FN Report View
// ──────────────────────────────────────────────────────────────────────
function ReportView({ report }: { report: RiskReport }) {
  const { summary } = report;
  const totalCategorized = summary.truePositives + summary.trueNegatives + summary.falsePositives + summary.falseNegatives;

  const pieData = [
    { name: 'True Positives', value: summary.truePositives, color: PIE_COLORS[0] },
    { name: 'True Negatives', value: summary.trueNegatives, color: PIE_COLORS[1] },
    { name: 'False Positives', value: summary.falsePositives, color: PIE_COLORS[2] },
    { name: 'False Negatives', value: summary.falseNegatives, color: PIE_COLORS[3] },
  ].filter(d => d.value > 0);

  return (
    <>
      {/* KPI Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiTile
          label="Total Assessments"
          value={summary.totalAssessments}
          sub={`${summary.pendingReview} pending review`}
          icon={<Activity className="h-5 w-5 text-blue-500" />}
        />
        <KpiTile
          label="Precision"
          value={summary.precision !== null ? `${(summary.precision * 100).toFixed(1)}%` : '—'}
          sub="TP / (TP + FP)"
          icon={<Target className="h-5 w-5 text-purple-500" />}
        />
        <KpiTile
          label="Recall"
          value={summary.recall !== null ? `${(summary.recall * 100).toFixed(1)}%` : '—'}
          sub="TP / (TP + FN)"
          icon={<TrendingUp className="h-5 w-5 text-green-500" />}
        />
        <KpiTile
          label="FN Loss Amount"
          value={`৳ ${summary.lossAmount.falseNegatives.toLocaleString()}`}
          sub={`TP loss: ৳ ${summary.lossAmount.truePositives.toLocaleString()}`}
          icon={<TrendingDown className="h-5 w-5 text-red-500" />}
        />
      </div>

      {/* Confusion Matrix + Pie */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Outcome Distribution</CardTitle>
            <CardDescription>
              {totalCategorized} categorized · {summary.pendingReview} pending ·{' '}
              {new Date(report.period.from).toLocaleDateString()} → {new Date(report.period.to).toLocaleDateString()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No categorized outcomes yet. Record outcomes on assessments to populate this chart.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Confusion Matrix</CardTitle>
            <CardDescription>Flagged vs. actual outcome</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div></div>
              <div className="font-medium">Actual Negative</div>
              <div className="font-medium">Actual Positive</div>

              <div className="font-medium text-right pr-2">Flagged</div>
              <div className="p-3 bg-red-50 border rounded">
                <div className="text-2xl font-bold text-red-700">{summary.falsePositives}</div>
                <div className="text-xs text-red-600">False Positive</div>
              </div>
              <div className="p-3 bg-green-50 border rounded">
                <div className="text-2xl font-bold text-green-700">{summary.truePositives}</div>
                <div className="text-xs text-green-600">True Positive</div>
              </div>

              <div className="font-medium text-right pr-2">Allowed</div>
              <div className="p-3 bg-green-50 border rounded">
                <div className="text-2xl font-bold text-green-700">{summary.trueNegatives}</div>
                <div className="text-xs text-green-600">True Negative</div>
              </div>
              <div className="p-3 bg-orange-50 border rounded">
                <div className="text-2xl font-bold text-orange-700">{summary.falseNegatives}</div>
                <div className="text-xs text-orange-600">False Negative</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-Reason-Code Breakdown */}
      {report.byReasonCode.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Per-Rule Analysis</CardTitle>
            <CardDescription>
              FP/FN rates by reason code — identifies which rules over- or under-trigger
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={report.byReasonCode}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="reasonCode" angle={-20} textAnchor="end" height={80} interval={0} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="tp" stackId="a" fill="#10b981" name="True Positive" />
                <Bar dataKey="tn" stackId="a" fill="#22c55e" name="True Negative" />
                <Bar dataKey="fp" stackId="a" fill="#ef4444" name="False Positive" />
                <Bar dataKey="fn" stackId="a" fill="#f97316" name="False Negative" />
              </BarChart>
            </ResponsiveContainer>

            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>Reason Code</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">TP</TableHead>
                  <TableHead className="text-right">TN</TableHead>
                  <TableHead className="text-right">FP</TableHead>
                  <TableHead className="text-right">FN</TableHead>
                  <TableHead className="text-right">FP Rate</TableHead>
                  <TableHead className="text-right">FN Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byReasonCode.map((r) => (
                  <TableRow key={r.reasonCode}>
                    <TableCell className="font-mono text-xs">{r.reasonCode}</TableCell>
                    <TableCell className="text-right">{r.count}</TableCell>
                    <TableCell className="text-right text-green-600">{r.tp}</TableCell>
                    <TableCell className="text-right text-green-600">{r.tn}</TableCell>
                    <TableCell className="text-right text-red-600">{r.fp}</TableCell>
                    <TableCell className="text-right text-orange-600">{r.fn}</TableCell>
                    <TableCell className="text-right">
                      {r.falsePositiveRate !== null ? `${(r.falsePositiveRate * 100).toFixed(0)}%` : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.falseNegativeRate !== null ? `${(r.falseNegativeRate * 100).toFixed(0)}%` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Recommendations */}
      <Alert>
        <Lightbulb className="h-4 w-4" />
        <AlertTitle>Tuning Recommendations</AlertTitle>
        <AlertDescription>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            {report.recommendations.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </AlertDescription>
      </Alert>

      {/* Threshold Changes Timeline */}
      {report.thresholdChanges && report.thresholdChanges.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Tuning History (this period)</CardTitle>
            <CardDescription>
              Threshold changes recorded during the report period — correlate with FP/FN shifts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Changed At</TableHead>
                  <TableHead>Threshold</TableHead>
                  <TableHead>Old → New</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.thresholdChanges.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-xs">{new Date(c.changedAt).toLocaleString()}</TableCell>
                    <TableCell><code className="text-xs bg-slate-100 px-2 py-0.5 rounded">RISK_{c.thresholdKey}</code></TableCell>
                    <TableCell className="font-mono text-xs">
                      <span className="text-red-600">{c.oldValue ?? '—'}</span>
                      <span className="mx-2">→</span>
                      <span className="text-green-600">{c.newValue}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.reason ?? '—'}</TableCell>
                    <TableCell className="text-xs">{c.changedBy === 'unknown' ? '—' : c.changedBy.slice(0, 8)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function KpiTile({ label, value, sub, icon }: { label: string; value: string | number; sub: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          {icon}
        </div>
        <div className="text-2xl font-bold mt-2">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{sub}</div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Assessments Table + Outcome Recorder
// ──────────────────────────────────────────────────────────────────────
function AssessmentsTable({ assessments, onOutcomeRecorded }: { assessments: RiskAssessment[]; onOutcomeRecorded: () => void }) {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [outcomeType, setOutcomeType] = useState('completed');
  const [outcomeAmount, setOutcomeAmount] = useState('');
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitOutcome(assessmentId: string) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/admin/risk-assessments/${assessmentId}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcomeType,
          outcomeAmount: outcomeAmount ? parseFloat(outcomeAmount) : null,
          outcomeNotes: outcomeNotes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Failed to record outcome');
        return;
      }
      toast.success('Outcome recorded');
      setRecordingId(null);
      setOutcomeAmount('');
      setOutcomeNotes('');
      onOutcomeRecorded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  if (assessments.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Target className="h-10 w-10 mx-auto mb-2 opacity-50" />
          No risk assessments recorded yet.
          <br />
          Assessments are created automatically when the InternalRiskProvider evaluates a customer, sale, lead, or delivery.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Risk Assessments</CardTitle>
        <CardDescription>
          Record the actual outcome of each transaction to populate the FP/FN report.
          Outcomes feed back into the tuning recommendations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Assessed At</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead>Reason Codes</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assessments.map((a) => (
              <>
                <TableRow key={a.id}>
                  <TableCell className="text-xs">{new Date(a.assessedAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="text-xs">
                      <Badge variant="outline" className="mr-1">{a.subjectType}</Badge>
                      <code className="font-mono">{a.subjectId.slice(0, 8)}…</code>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={DECISION_COLORS[a.decision] ?? 'bg-gray-100'}>{a.decision}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{a.score ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {a.reasonCodes.slice(0, 3).map((r) => (
                        <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
                      ))}
                      {a.reasonCodes.length > 3 && <Badge variant="outline" className="text-xs">+{a.reasonCodes.length - 3}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {a.outcomes.length > 0 ? (
                      <Badge className={OUTCOME_COLORS[a.outcomes[0].outcomeType] ?? 'bg-gray-100'}>
                        {a.outcomes[0].outcomeType}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRecordingId(recordingId === a.id ? null : a.id)}
                    >
                      {a.outcomes.length > 0 ? 'Update' : 'Record Outcome'}
                    </Button>
                  </TableCell>
                </TableRow>
                {recordingId === a.id && (
                  <TableRow key={a.id + '-form'} className="bg-slate-50">
                    <TableCell colSpan={7} className="p-4">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                        <div>
                          <Label className="text-xs">Outcome Type</Label>
                          <Select value={outcomeType} onValueChange={setOutcomeType}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="completed">Completed</SelectItem>
                              <SelectItem value="no_issue">No Issue</SelectItem>
                              <SelectItem value="returned">Returned</SelectItem>
                              <SelectItem value="charged_back">Charged Back</SelectItem>
                              <SelectItem value="refunded">Refunded</SelectItem>
                              <SelectItem value="fraud_confirmed">Fraud Confirmed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Loss Amount (৳)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={outcomeAmount}
                            onChange={(e) => setOutcomeAmount(e.target.value)}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Label className="text-xs">Notes</Label>
                          <Textarea
                            placeholder="Optional notes about this outcome…"
                            value={outcomeNotes}
                            onChange={(e) => setOutcomeNotes(e.target.value)}
                            rows={2}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" onClick={() => submitOutcome(a.id)} disabled={submitting}>
                          {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                          Save Outcome
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setRecordingId(null)}>
                          <XCircle className="h-4 w-4 mr-2" /> Cancel
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Thresholds View
// ──────────────────────────────────────────────────────────────────────
function ThresholdsView({ config }: { config: RiskConfig }) {
  const groupedConfig: Record<string, Array<{ key: string; value: number }>> = {
    'Velocity Rule': [
      { key: 'VELOCITY_WINDOW_HOURS', value: config.VELOCITY_WINDOW_HOURS },
      { key: 'VELOCITY_AMOUNT_THRESHOLD', value: config.VELOCITY_AMOUNT_THRESHOLD },
      { key: 'VELOCITY_COUNT_THRESHOLD', value: config.VELOCITY_COUNT_THRESHOLD },
    ],
    'Outstanding AR Rule': [
      { key: 'CUSTOMER_DEBT_THRESHOLD', value: config.CUSTOMER_DEBT_THRESHOLD },
      { key: 'CUSTOMER_DEBT_ELEVATED_THRESHOLD', value: config.CUSTOMER_DEBT_ELEVATED_THRESHOLD },
    ],
    'Return Ratio Rule': [
      { key: 'RETURN_RATIO_HIGH', value: config.RETURN_RATIO_HIGH },
      { key: 'RETURN_RATIO_ELEVATED', value: config.RETURN_RATIO_ELEVATED },
    ],
    'Failed Payments Rule': [
      { key: 'FAILED_PAYMENT_THRESHOLD', value: config.FAILED_PAYMENT_THRESHOLD },
    ],
    'Delivery COD Rule': [
      { key: 'DELIVERY_COD_HIGH_AMOUNT', value: config.DELIVERY_COD_HIGH_AMOUNT },
    ],
    'Sale Amount Tiers': [
      { key: 'SALE_AMOUNT_VERY_HIGH', value: config.SALE_AMOUNT_VERY_HIGH },
      { key: 'SALE_AMOUNT_HIGH', value: config.SALE_AMOUNT_HIGH },
    ],
    'Score Increments': [
      { key: 'SCORE_LEAD_BASE', value: config.SCORE_LEAD_BASE },
      { key: 'SCORE_HIGH_AR', value: config.SCORE_HIGH_AR },
      { key: 'SCORE_ELEVATED_AR', value: config.SCORE_ELEVATED_AR },
      { key: 'SCORE_HIGH_VELOCITY_COUNT', value: config.SCORE_HIGH_VELOCITY_COUNT },
      { key: 'SCORE_HIGH_VELOCITY_AMOUNT', value: config.SCORE_HIGH_VELOCITY_AMOUNT },
      { key: 'SCORE_HIGH_RETURN_RATIO', value: config.SCORE_HIGH_RETURN_RATIO },
      { key: 'SCORE_ELEVATED_RETURN_RATIO', value: config.SCORE_ELEVATED_RETURN_RATIO },
      { key: 'SCORE_REPEATED_PAYMENT_FAILURE', value: config.SCORE_REPEATED_PAYMENT_FAILURE },
      { key: 'SCORE_CREDIT_LIMIT_EXCEEDED', value: config.SCORE_CREDIT_LIMIT_EXCEEDED },
      { key: 'SCORE_HIGH_COD_AMOUNT', value: config.SCORE_HIGH_COD_AMOUNT },
      { key: 'SCORE_VERY_HIGH_AMOUNT', value: config.SCORE_VERY_HIGH_AMOUNT },
      { key: 'SCORE_HIGH_AMOUNT', value: config.SCORE_HIGH_AMOUNT },
    ],
    'Decision Thresholds': [
      { key: 'DECISION_BLOCK_THRESHOLD', value: config.DECISION_BLOCK_THRESHOLD },
      { key: 'DECISION_REVIEW_THRESHOLD', value: config.DECISION_REVIEW_THRESHOLD },
    ],
  };

  return (
    <>
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Env-Configurable</AlertTitle>
        <AlertDescription>
          All thresholds are tunable via environment variables with the <code className="bg-slate-100 px-1 rounded">RISK_</code> prefix.
          Example: set <code className="bg-slate-100 px-1 rounded">RISK_VELOCITY_COUNT_THRESHOLD=10</code> to trip
          HIGH_ORDER_VELOCITY at 10 orders instead of 20. Restart the app after changing env vars.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(groupedConfig).map(([group, items]) => (
          <Card key={group}>
            <CardHeader>
              <CardTitle className="text-base">{group}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.key}>
                      <TableCell className="font-mono text-xs py-2">{item.key}</TableCell>
                      <TableCell className="text-right font-mono py-2">
                        {typeof item.value === 'number' && item.value >= 1000
                          ? `৳ ${item.value.toLocaleString()}`
                          : item.value}
                      </TableCell>
                      <TableCell className="text-right py-2">
                        <code className="text-xs bg-slate-100 px-2 py-0.5 rounded">RISK_{item.key}</code>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Decision threshold visualization */}
      <Card>
        <CardHeader>
          <CardTitle>Decision Thresholds Visualization</CardTitle>
          <CardDescription>Score 0-100 → decision mapping</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0 (clean)</span>
              <span>35 (review)</span>
              <span>70 (block)</span>
              <span>100 (max)</span>
            </div>
            <div className="relative h-8 rounded overflow-hidden flex">
              <div className="bg-green-500 flex items-center justify-center text-xs text-white" style={{ width: '35%' }}>
                Allow
              </div>
              <div className="bg-yellow-500 flex items-center justify-center text-xs text-white" style={{ width: '35%' }}>
                Review
              </div>
              <div className="bg-red-500 flex items-center justify-center text-xs text-white" style={{ width: '30%' }}>
                Block
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              An assessment's final score (sum of all triggered rule increments) determines the decision.
              Tune <code className="bg-slate-100 px-1 rounded">RISK_DECISION_REVIEW_THRESHOLD</code> and{' '}
              <code className="bg-slate-100 px-1 rounded">RISK_DECISION_BLOCK_THRESHOLD</code> to shift these boundaries.
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
