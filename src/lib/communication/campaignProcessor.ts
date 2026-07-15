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
        const provider = providerRegistry.getSms((campaign as any).providerCode ?? 'ssl_wireless');
        if (!provider) throw new Error(`SMS provider ${(campaign as any).providerCode ?? 'ssl_wireless'} not registered`);
        const result = await provider.sendSms({ to: recipient.destination, message: (campaign as any).content ?? '' });
        await withTenant(ctx, async (tx) => {
          await tx.communicationCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
              status: result.status === 'sent' ? 'sent' : 'failed',
              skipReason: result.status === 'failed' ? 'Provider returned failed' : null,
            },
          });
        });
        if (result.status === 'sent') sent++;
        else failed++;
      } else if (campaign.channel === 'email') {
        const provider = providerRegistry.getEmail((campaign as any).providerCode ?? 'resend');
        if (!provider) throw new Error(`Email provider ${(campaign as any).providerCode ?? 'resend'} not registered`);
        const result = await provider.sendEmail({
          to: recipient.destination,
          subject: (campaign as any).subject ?? campaign.name,
          htmlBody: (campaign as any).content ?? '',
        });
        await withTenant(ctx, async (tx) => {
          await tx.communicationCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
              status: result.status === 'sent' ? 'sent' : 'failed',
              skipReason: result.status === 'failed' ? 'Provider returned failed' : null,
            },
          });
        });
        if (result.status === 'sent') sent++;
        else failed++;
      }
    } catch (e) {
      failed++;
      await withTenant(ctx, async (tx) => {
        await tx.communicationCampaignRecipient.update({
          where: { id: recipient.id },
          data: { status: 'failed', skipReason: e instanceof Error ? e.message : 'Unknown error' },
        });
      }).catch(() => {/* swallow — already counted as failed */});
    }
  }

  return { sent, failed };
}
