// Worker side of the due reminder engine (src/domain/receivables/reminders.ts).
//
// A repeatable 'tick' (every TICK_MS) finds the companies with reminders on or
// an SMS account, and for each, in that company's own tenant context:
// plans today's stages, queues messages inside the sending window, recovers
// sends interrupted by a crash, polls delivery reports, and enqueues one send
// job per message ready to go. Send jobs run on their own queue with bounded
// concurrency; each claims its message in the database first, so a duplicate
// job, a retried job or a second worker sends nothing.
//
// Listing the companies is the one read outside a tenant context: it reads
// company ids only, and all work for a company runs scoped to that company.

import { systemDb } from '@/lib/db';
import { buildTenantContext } from '@/lib/db/transaction';
import {
  planDueReminders, pollDeliveryReports, queueDueReminderMessages, recoverInterruptedSends, sendableMessageIds,
} from '@/domain/receivables/reminders';
import { SMS_PROVIDER } from '@/lib/sms/credentials';

export const TICK_MS = 5 * 60_000;
export const SEND_CONCURRENCY = 4;

export function reminderContext(companyId: string) {
  return buildTenantContext({ companyId, userId: 'system:due-reminders', branchIds: [], allBranches: true, isGlobal: false });
}

export async function companiesWithSms(): Promise<string[]> {
  const [policies, accounts] = await Promise.all([
    systemDb.reminderPolicy.findMany({ where: { enabled: true }, select: { companyId: true } }),
    systemDb.integrationCredential.findMany({ where: { provider: SMS_PROVIDER, status: 'active' }, select: { companyId: true } }),
  ]);
  return [...new Set([...policies, ...accounts].map(r => r.companyId))];
}

export interface TickResult { companyId: string; planned: number; queued: number; skipped: number; recovered: number; delivered: number; failed: number; enqueued: number }

/**
 * One pass over every company. `enqueueSend` hands a message to the send
 * queue; a company that fails is reported and does not stop the others.
 */
export async function runDueReminderTick(
  enqueueSend: (companyId: string, messageId: string) => Promise<unknown>,
  now = new Date(),
  onCompanyError: (companyId: string, error: unknown) => void = () => undefined,
): Promise<TickResult[]> {
  const results: TickResult[] = [];
  for (const companyId of await companiesWithSms()) {
    try {
      const ctx = reminderContext(companyId);
      const planned = await planDueReminders(ctx, now);
      const { queued, skipped } = await queueDueReminderMessages(ctx, now);
      const recovered = await recoverInterruptedSends(ctx, now);
      const { delivered, failed } = await pollDeliveryReports(ctx, now);
      const ids = await sendableMessageIds(ctx, now);
      for (const id of ids) await enqueueSend(companyId, id);
      results.push({ companyId, planned, queued, skipped, recovered, delivered, failed, enqueued: ids.length });
    } catch (error) {
      onCompanyError(companyId, error);
    }
  }
  return results;
}
