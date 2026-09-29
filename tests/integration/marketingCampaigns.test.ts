// Marketing SMS campaigns on the disposable MariaDB, MiMSMS mocked.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { localDate, zonedMidnight } from '@/domain/receivables/calendar';
import { sendOutboundMessage } from '@/domain/receivables/reminders';
import {
  cancelCampaign, completeFinishedCampaigns, createCampaign, listCampaigns, previewCampaign, sendCampaign,
} from '@/domain/communication/campaigns';
import { saveSmsCredentials } from '@/lib/sms/credentials';
import { db as appDb } from '@/lib/db';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const A: string = randomUUID();
const TZ = 'Asia/Dhaka';
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
const ctx = () => ({ companyId: A, branchIds: [], allBranches: true, isGlobal: false, userId: undefined, correlationId: randomUUID(), requestId: randomUUID() }) as never;
const tx = appDb as unknown as Prisma.TransactionClient;
const at = (hour = 10) => new Date(zonedMidnight(TZ, localDate(TZ)).getTime() + hour * 3_600_000);
const provider = vi.fn(async () => new Response(JSON.stringify({ statusCode: '200', status: 'Success', success_Data: [{ trackingId: `TRK${randomUUID().slice(0, 6)}`, sms_Count: 1 }] }), { status: 200 }));

let seq = 0;
async function customer(name: string, phone: string | null, marketing?: 'granted' | 'withdrawn') {
  const c = await db.customer.create({ data: { companyId: A, name, phone } });
  if (marketing) await db.communicationConsent.create({ data: { companyId: A, customerId: c.id, channel: 'sms', purpose: 'marketing', consentStatus: marketing, source: 'test', capturedAt: new Date(Date.now() - 60_000 + ++seq) } });
  return c;
}

beforeAll(async () => {
  fx = await ensureSyntheticIssuerTenant(db, { companyId: A, label: 'MC', code: `SYN-MC-${A.slice(0, 8)}` });
  await withTenant(ctx(), t => saveSmsCredentials(t, A, fx.user.id, { userName: 'ops@example.com', apiKey: 'SECRETKEY123456', senderName: 'MYSHOP' }));
}, 120_000);
afterAll(() => db.$disconnect());

describe('marketing campaigns', () => {
  it('reach only consenting customers with a valid, unique number, sent as promotional and re-checked before sending', async () => {
    await customer('Karim', '01711000001', 'granted');
    await customer('No consent', '01711000002');
    await customer('Bad number', '12345', 'granted');
    await customer('Same number', '01711000001', 'granted');
    const later = await customer('Changes mind', '01711000005', 'granted');
    await customer('Withdrew', '01711000006', 'withdrawn');

    await expect(withTenant(ctx(), t => createCampaign(t, A, { name: 'Eid', text: 'Hi {{customer_name}} {{due_amount}}', locale: 'en' }, fx.user.id))).rejects.toThrow(/Unknown placeholder/);
    const campaign = await withTenant(ctx(), t => createCampaign(t, A, { name: 'Eid offer', text: 'Eid Mubarak {{customer_name}}! 10% off at {{company_name}}.', locale: 'en' }, fx.user.id));
    const preview = await runInTenantContext(ctx(), () => previewCampaign(tx, A, campaign.id, at()));
    expect(preview).toMatchObject({ matched: 6, eligible: 2, no_marketing_consent: 2, invalid_phone: 1, duplicate_phone: 1, segments_each: 1 });
    expect(preview.sample).toMatch(/^Eid Mubarak (Karim|Same number|Changes mind)! 10% off at /);

    await expect(withTenant(ctx(), t => sendCampaign(t, A, campaign.id, '0'.repeat(64), fx.user.id, at()))).rejects.toThrow(/preview again/);
    const sent = await withTenant(ctx(), t => sendCampaign(t, A, campaign.id, preview.confirmation_token, fx.user.id, at()));
    expect(sent.queued).toBe(2);
    await expect(withTenant(ctx(), t => sendCampaign(t, A, campaign.id, preview.confirmation_token, fx.user.id, at()))).rejects.toThrow(/is running/);
    expect(await db.communicationCampaignRecipient.count({ where: { campaignId: campaign.id, status: 'skipped' } })).toBe(4);

    const messages = await db.outboundMessage.findMany({ where: { companyId: A, triggerSource: 'campaign' } });
    expect(messages.every(m => m.purpose === 'marketing' && !m.destinationEncrypted.includes('01711'))).toBe(true);
    // Karim and 'Same number' share a mobile: whichever sorts first gets the one message.
    const toYes = messages.find(m => m.customerId !== later.id)!;
    const toLater = messages.find(m => m.customerId === later.id)!;

    expect(await sendOutboundMessage(ctx(), toYes.id, at(), provider as never)).toBe('sent');
    const body = JSON.parse((provider.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ transactionType: 'P', campaignName: 'Eid offer', message: expect.stringMatching(/^Eid Mubarak (Karim|Same number)!/) });

    // Consent withdrawn after queuing: not sent.
    await db.communicationConsent.create({ data: { companyId: A, customerId: later.id, channel: 'sms', purpose: 'marketing', consentStatus: 'withdrawn', source: 'test' } });
    expect(await sendOutboundMessage(ctx(), toLater.id, at(), provider as never)).toBe('skipped');
    expect(provider).toHaveBeenCalledTimes(1);

    expect(await withTenant(ctx(), t => completeFinishedCampaigns(t, A))).toBe(1);
    const listed = (await runInTenantContext(ctx(), () => listCampaigns(tx, A))).items.find(c => c.id === campaign.id)!;
    expect(listed).toMatchObject({ status: 'completed', skipped: 4, messages: { sent: 1, skipped: 1 } });
  });

  it('cancel stops the messages not yet sent', async () => {
    await customer('Another', '01711000009', 'granted');
    const campaign = await withTenant(ctx(), t => createCampaign(t, A, { name: 'Flash sale', text: 'Sale today at {{company_name}}', locale: 'en' }, fx.user.id));
    const preview = await runInTenantContext(ctx(), () => previewCampaign(tx, A, campaign.id, at()));
    await withTenant(ctx(), t => sendCampaign(t, A, campaign.id, preview.confirmation_token, fx.user.id, at()));
    const result = await withTenant(ctx(), t => cancelCampaign(t, A, campaign.id, fx.user.id));
    expect(result.cancelledMessages).toBe(preview.eligible);
    const queued = await db.outboundMessage.count({ where: { companyId: A, status: 'queued', campaignRecipient: { campaignId: campaign.id } } });
    expect(queued).toBe(0);
    await expect(withTenant(ctx(), t => cancelCampaign(t, A, campaign.id, fx.user.id))).rejects.toThrow(/is cancelled/);
  });

  it('the database refuses a campaign message without its recipient', async () => {
    await expect(db.outboundMessage.create({ data: { companyId: A, triggerSource: 'campaign', destinationHash: 'x', destinationEncrypted: 'x', renderedBody: 'x' } }))
      .rejects.toThrow();
  });
});
