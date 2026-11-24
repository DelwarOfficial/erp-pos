'use client';
// Approvals: requests waiting for a second person (maker-checker).
// Consumes: GET /api/v1/approvals?status=pending, POST /api/v1/approvals/{id}/resolve
// The server refuses a user resolving their own request and requires a fresh
// MFA session to resolve.
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useDashboardSession } from '@/components/dashboard/session';
import { useWorkflowMutation } from '@/hooks/useWorkflowMutation';
import { formatDateTime, formatMoney } from '@/lib/i18n/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';

interface ApprovalRow {
  id: string; requestType: string; referenceType: string; referenceId: string;
  requestedBy: string; requestedAt: string; reason: string; payload: string;
}

function readPayload(raw: string): Record<string, unknown> {
  try { const value = JSON.parse(raw); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
}

function describe(row: ApprovalRow, payload: Record<string, unknown>) {
  if (row.requestType === 'large_refund') {
    const sale = typeof payload.sale_reference_no === 'string' ? payload.sale_reference_no : row.referenceId.slice(0, 8);
    return { title: `Large refund on sale ${sale}`,
      detail: `Returns and refunds on this sale up to ${formatMoney(String(payload.refund_total ?? '0'))}${typeof payload.customer === 'string' ? ` for ${payload.customer}` : ''}.` };
  }
  return { title: row.requestType.replaceAll('_', ' '), detail: `${row.referenceType.replaceAll('_', ' ')} ${row.referenceId.slice(0, 8)}` };
}

export default function ApprovalsPage() {
  const session = useDashboardSession();
  const can = (code: string) => !!(session?.is_global || session?.permissions.includes(code));
  const command = useWorkflowMutation();
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiFetch('/api/v1/approvals?status=pending&limit=100');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? 'Unable to load approvals');
      setRows(data.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load approvals'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function resolve(row: ApprovalRow, decision: 'approved' | 'rejected') {
    const { title } = describe(row, readPayload(row.payload));
    if (!window.confirm(`${decision === 'approved' ? 'Approve' : 'Reject'}: ${title}?`)) return;
    const result = await command.mutate(`/api/v1/approvals/${row.id}/resolve`, { decision, reason: `${decision === 'approved' ? 'Approved' : 'Rejected'} from Approvals` });
    if (result) { toast.success(decision === 'approved' ? 'Approved. They can go ahead now.' : 'Rejected.'); await load(); }
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Approvals</h1><p className="text-muted-foreground">Requests waiting for a second person. You can&apos;t approve your own.</p></div>
      <Button variant="outline" disabled={loading || command.pending} onClick={() => void load()}>Refresh</Button>
    </div>
    {error || command.error ? <div role="alert" className="space-y-2 rounded-md border p-4"><p>{error || command.error}</p>{error ? <Button variant="outline" onClick={() => void load()}>Retry</Button> : null}</div> : null}
    {loading ? <p role="status">Loading approvals…</p> : null}
    {!loading && !error && rows.length === 0 ? <p className="text-muted-foreground">Nothing is waiting for approval.</p> : null}
    <ul className="space-y-3">{rows.map(row => {
      const { title, detail } = describe(row, readPayload(row.payload));
      const own = row.requestedBy === session?.id;
      return <li key={row.id}><Card><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
        <div className="space-y-1"><p className="font-medium">{title}</p><p className="text-sm">{detail}</p>
          <p className="text-xs text-muted-foreground">Requested {formatDateTime(row.requestedAt)}{own ? ' by you' : ''}</p></div>
        {own ? <Badge variant="secondary">Waiting for someone else</Badge>
          : can('approval.resolve') ? <div className="flex gap-2">
            <Button disabled={command.pending} onClick={() => void resolve(row, 'approved')}>Approve</Button>
            <Button variant="outline" disabled={command.pending} onClick={() => void resolve(row, 'rejected')}>Reject</Button>
          </div> : null}
      </CardContent></Card></li>;
    })}</ul>
  </div>;
}
