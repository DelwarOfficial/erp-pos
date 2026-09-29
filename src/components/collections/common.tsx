// Shared pieces for the collection and SMS screens.
//
// Money arrives from the API as decimal strings and is only ever displayed
// here -- formatted from the string, never through a JavaScript number. What
// is owed is computed on the server (src/domain/receivables).

'use client';

import { Badge } from '@/components/ui/badge';
import { useDashboardSession } from '@/components/dashboard/session';
import { formatTaka } from '@/domain/receivables/reminderTemplates';

export function Taka({ value, className }: { value: string | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={className}>—</span>;
  return <span className={`tabular-nums ${className ?? ''}`}>৳{formatTaka(value)}</span>;
}

/** Hides what the user cannot do. The server enforces every permission regardless. */
export function useCan() {
  const user = useDashboardSession();
  return (permission: string) => Boolean(user && (user.is_global || user.permissions.includes(permission)));
}

export function newIdempotencyKey(prefix: string) {
  return `${prefix}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

const SMS_STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  queued: { label: 'Queued', variant: 'outline' },
  sending: { label: 'Sending', variant: 'outline' },
  sent: { label: 'Sent', variant: 'secondary' },
  delivered: { label: 'Delivered', variant: 'default' },
  failed: { label: 'Failed', variant: 'destructive' },
  dead_letter: { label: 'Gave up', variant: 'destructive' },
  unknown: { label: 'Unknown — check', variant: 'destructive' },
  skipped: { label: 'Skipped', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
};

export function SmsStatusBadge({ status }: { status: string }) {
  const s = SMS_STATUS[status] ?? { label: status, variant: 'outline' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

const INSTALLMENT_STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  paid: { label: 'Paid', variant: 'default' },
  partially_paid: { label: 'Part paid', variant: 'secondary' },
  pending: { label: 'Pending', variant: 'outline' },
  overdue: { label: 'Overdue', variant: 'destructive' },
};

export function InstallmentStatusBadge({ status }: { status: string }) {
  const s = INSTALLMENT_STATUS[status] ?? { label: status, variant: 'outline' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function PhoneStatus({ masked, status }: { masked: string | null; status: string }) {
  if (status === 'ok' && masked) return <span className="font-mono text-xs">{masked}</span>;
  return <Badge variant="destructive">{status === 'missing' ? 'No mobile' : 'Invalid mobile'}</Badge>;
}

/** Why a reminder was not sent, in words. */
export const SKIP_REASONS: Record<string, string> = {
  paid: 'Already paid', below_minimum: 'Below the minimum amount', opted_out: 'Customer opted out of SMS',
  missing_phone: 'No mobile number', invalid_phone: 'Invalid mobile number', customer_daily_limit: 'Customer already reminded today',
  company_daily_limit: 'Daily SMS limit reached', stage_passed: 'Reminder day passed', due_date_changed: 'Due date changed',
  installment_cancelled: 'Installment cancelled', sale_not_open: 'Sale voided or returned', reminders_off_for_sale: 'Reminders off for this sale',
  policy_disabled: 'Automatic reminders are off', sms_account_not_configured: 'No SMS account configured', sms_account_unreadable: 'SMS account must be entered again',
  campaign_cancelled: 'Campaign cancelled', interrupted_during_send: 'Interrupted while sending',
};

export async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body?.error?.message ?? body?.message ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}
