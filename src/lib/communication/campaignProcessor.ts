// src/lib/communication/campaignProcessor.ts
// Worker-side processor for communication campaigns.
// Reads pending campaigns and dispatches individual SMS/email/notification sends
// via the provider registry. Per §7.16 + §20.D16.

import { db } from '@/lib/db';
import { providerRegistry } from '@/adapters';
import { withTenant, buildTenantContext } from '@/lib/db/transaction';

/**
 * Process a communication campaign by ID — sends all pending recipient messages
 * via the registered SMS/email providers. Idempotent: skips recipients already
 * marked 'sent'.
 */
export async function processCommunicationCampaign(campaignId: string): Promise<{ sent: number; failed: number }> {
  const campaign = await db.communicationCampaign.findUnique({
    where: { id: campaignId },
    include: { recipients: { where: { status: 'pending' }, take: 500 } },
  });
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const ctx = buildTenantContext({
    companyId: campaign.companyId,
    userId: 'system:communication-worker',
    branchIds: [],
    isGlobal: true,
  });

  let sent = 0, failed = 0;

  for (const recipient of campaign.recipients) {
    try {
      if (campaign.channel === 'sms') {
        const provider = providerRegistry.getSms(campaign.providerCode);
        if (!provider) throw new Error(`SMS provider ${campaign.providerCode} not registered`);
        const result = await provider.sendSms({ to: recipient.recipientContact, message: campaign.content });
        await withTenant(ctx, async (tx) => {
          await tx.communicationRecipient.update({
            where: { id: recipient.id },
            data: {
              status: result.status === 'sent' ? 'sent' : 'failed',
              providerMessageId: result.providerMessageId || null,
              sentAt: result.status === 'sent' ? new Date() : null,
              errorMessage: result.status === 'failed' ? 'Provider returned failed' : null,
            },
          });
        });
        if (result.status === 'sent') sent++;
        else failed++;
      } else if (campaign.channel === 'email') {
        const provider = providerRegistry.getEmail(campaign.providerCode);
        if (!provider) throw new Error(`Email provider ${campaign.providerCode} not registered`);
        const result = await provider.sendEmail({
          to: recipient.recipientContact,
          subject: campaign.subject ?? campaign.name,
          htmlBody: campaign.content,
        });
        await withTenant(ctx, async (tx) => {
          await tx.communicationRecipient.update({
            where: { id: recipient.id },
            data: {
              status: result.status === 'sent' ? 'sent' : 'failed',
              providerMessageId: result.providerMessageId || null,
              sentAt: result.status === 'sent' ? new Date() : null,
              errorMessage: result.status === 'failed' ? 'Provider returned failed' : null,
            },
          });
        });
        if (result.status === 'sent') sent++;
        else failed++;
      }
    } catch (e) {
      failed++;
      await withTenant(ctx, async (tx) => {
        await tx.communicationRecipient.update({
          where: { id: recipient.id },
          data: { status: 'failed', errorMessage: e instanceof Error ? e.message : 'Unknown error' },
        });
      }).catch(() => {/* swallow — already counted as failed */});
    }
  }

  return { sent, failed };
}
