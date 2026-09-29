// Marketing SMS campaigns (blueprint §5.11A, "Marketing campaigns").
//
//   draft    a name, a text and an audience (all customers, or one customer
//            group). The text is a communication_templates row, purpose
//            'marketing', with {{customer_name}} / {{company_name}} only.
//   preview  who would receive it and why the others would not; a
//            confirmation token over exactly that set.
//   send     recomputes the set, refuses if it differs from the preview or
//            exceeds today's company SMS limit, then records one recipient row
//            per customer and one outbound_messages row per eligible one
//            (trigger 'campaign', purpose 'marketing'). The reminder worker
//            sends them through the same claim-and-revalidate path; each is
//            re-checked for consent and the campaign still running just before
//            it goes, and sent as promotional (DND applies at the provider).
//   cancel   stops a campaign; queued messages are cancelled.
//
// Only customers whose latest marketing SMS consent is 'granted' are messaged.
// Numbers are stored encrypted on the message; the recipient row keeps a hash.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';
import { encryptString, sha256 } from '@/lib/crypto';
import { localDate, zonedMidnight } from '@/domain/receivables/calendar';
import { normalizeBdMobile } from '@/domain/receivables/phone';
import { smsSegments } from '@/domain/receivables/smsSegments';
import { policyFromRow } from '@/domain/receivables/reminderPolicy';

type Tx = Prisma.TransactionClient;
export const CAMPAIGN_PLACEHOLDERS = ['customer_name', 'company_name'] as const;
export const CAMPAIGN_TEXT_MAX = 700;
export const CAMPAIGN_AUDIENCE_MAX = 5000;
const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g;
const COUNTED = ['queued', 'sending', 'sent', 'delivered', 'unknown'];
const LANGUAGE = { bn: { locale: 'bn-BD', name: 'Bangla (Bangladesh)', nativeName: 'বাংলা' }, en: { locale: 'en-BD', name: 'English (Bangladesh)', nativeName: 'English' } } as const;

function invalid(message: string, status = 400, details: Record<string, unknown> = {}): never {
  throw new DomainError('VALIDATION_FAILED', message, details, status);
}

export function checkCampaignText(text: string) {
  const body = text.trim();
  if (!body) invalid('The text is empty');
  if (body.length > CAMPAIGN_TEXT_MAX) invalid(`At most ${CAMPAIGN_TEXT_MAX} characters`);
  const unknown = [...body.matchAll(TOKEN)].map(m => m[1]).filter(t => !(CAMPAIGN_PLACEHOLDERS as readonly string[]).includes(t));
  if (unknown.length) invalid(`Unknown placeholder(s): ${unknown.join(', ')}. Allowed: ${CAMPAIGN_PLACEHOLDERS.join(', ')}`, 400, { unknown });
  return body;
}

export function renderCampaign(text: string, values: { customer_name: string; company_name: string }) {
  return text.replace(TOKEN, (_, name: keyof typeof values) => values[name]).trim();
}

/** Each customer's latest consent for SMS of a purpose ('granted' / 'withdrawn' / none). */
export async function latestSmsConsent(tx: Tx, companyId: string, customerIds: string[], purpose: 'marketing' | 'transactional') {
  if (customerIds.length === 0) return new Map<string, string>();
  const rows = await tx.$queryRaw<Array<{ customer_id: string; consent_status: string }>>`
    SELECT customer_id, consent_status FROM (
      SELECT customer_id, consent_status,
             ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY captured_at DESC, id DESC) AS rn
        FROM communication_consents
       WHERE company_id = ${companyId} AND channel = 'sms' AND purpose = ${purpose}
         AND customer_id IN (${Prisma.join(customerIds)})
    ) t WHERE rn = 1`;
  return new Map(rows.map(r => [r.customer_id, r.consent_status]));
}

async function companySetup(tx: Tx, companyId: string) {
  const [company, policyRow] = await Promise.all([
    tx.company.findFirst({ where: { id: companyId }, select: { displayName: true, timezone: true } }),
    tx.reminderPolicy.findFirst({ where: { companyId } }),
  ]);
  const policy = policyFromRow(policyRow);
  return { companyName: company?.displayName ?? '', timezone: company?.timezone ?? 'Asia/Dhaka', dailyLimit: policy?.dailyCompanyLimit ?? 500 };
}

// ── draft ───────────────────────────────────────────────────────────────────

export interface CreateCampaignInput { name: string; text: string; locale: 'bn' | 'en'; customerGroupId?: string }

export async function createCampaign(tx: Tx, companyId: string, input: CreateCampaignInput, userId: string) {
  const name = input.name.trim();
  if (!name || name.length > 120) invalid('Give the campaign a name of up to 120 characters');
  const text = checkCampaignText(input.text);
  if (input.customerGroupId) {
    const group = await tx.customerGroup.findFirst({ where: { id: input.customerGroupId, companyId }, select: { id: true } });
    if (!group) throw new DomainError('RESOURCE_NOT_FOUND', 'Customer group not found', {}, 404);
  }
  const language = LANGUAGE[input.locale];
  const known = await tx.supportedLanguage.findUnique({ where: { locale: language.locale }, select: { locale: true } });
  if (!known) await tx.supportedLanguage.create({ data: { locale: language.locale, name: language.name, nativeName: language.nativeName, isActive: true } });
  const campaignId = randomUUID();
  const template = await tx.communicationTemplate.create({ data: {
    companyId, code: `campaign.${campaignId}`, channel: 'sms', purpose: 'marketing', locale: language.locale,
    bodyTemplate: text, allowedTokens: JSON.stringify(CAMPAIGN_PLACEHOLDERS), isActive: true, approvedBy: userId,
  } });
  const campaign = await tx.communicationCampaign.create({ data: {
    id: campaignId, companyId, name, channel: 'sms', templateId: template.id, locale: input.locale,
    audienceDefinition: JSON.stringify({ customer_group_id: input.customerGroupId ?? null }), status: 'draft', createdBy: userId,
  } });
  await tx.auditLog.create({ data: { companyId, userId, correlationId: randomUUID(), action: 'communication_campaign.create',
    entityType: 'communication_campaign', entityId: campaignId, afterValue: JSON.stringify({ name, locale: input.locale, customer_group_id: input.customerGroupId ?? null, text }) } });
  return campaign;
}

// ── audience ────────────────────────────────────────────────────────────────

interface Candidate { customerId: string; name: string; phone: string | null; reason: string | null }

async function loadCampaign(tx: Tx, companyId: string, campaignId: string) {
  const campaign = await tx.communicationCampaign.findFirst({ where: { id: campaignId, companyId, channel: 'sms' }, include: { template: { select: { bodyTemplate: true } } } });
  if (!campaign) throw new DomainError('RESOURCE_NOT_FOUND', 'Campaign not found', {}, 404);
  return campaign;
}

async function audience(tx: Tx, companyId: string, campaign: Awaited<ReturnType<typeof loadCampaign>>, now: Date) {
  const definition = JSON.parse(campaign.audienceDefinition || '{}') as { customer_group_id?: string | null };
  const customers = await tx.customer.findMany({
    where: { companyId, isActive: true, deletedAt: null, ...(definition.customer_group_id ? { customerGroupId: definition.customer_group_id } : {}) },
    select: { id: true, name: true, phone: true }, orderBy: { id: 'asc' }, take: CAMPAIGN_AUDIENCE_MAX + 1,
  });
  if (customers.length > CAMPAIGN_AUDIENCE_MAX) invalid(`The audience has more than ${CAMPAIGN_AUDIENCE_MAX} customers; narrow it with a customer group`, 409);
  const consent = await latestSmsConsent(tx, companyId, customers.map(c => c.id), 'marketing');
  const seen = new Set<string>();
  const candidates: Candidate[] = customers.map(c => {
    const phone = normalizeBdMobile(c.phone);
    let reason: string | null = null;
    if (consent.get(c.id) !== 'granted') reason = 'no_marketing_consent';
    else if (!c.phone) reason = 'missing_phone';
    else if (!phone) reason = 'invalid_phone';
    else if (seen.has(phone)) reason = 'duplicate_phone';
    if (!reason && phone) seen.add(phone);
    return { customerId: c.id, name: c.name, phone, reason };
  });
  const setup = await companySetup(tx, companyId);
  const since = zonedMidnight(setup.timezone, localDate(setup.timezone, now));
  const usedToday = await tx.outboundMessage.count({ where: { companyId, status: { in: COUNTED }, createdAt: { gte: since } } });
  return { candidates, setup, remaining: Math.max(0, setup.dailyLimit - usedToday) };
}

export interface CampaignPreview {
  matched: number; eligible: number; no_marketing_consent: number; missing_phone: number; invalid_phone: number; duplicate_phone: number;
  segments_each: number; segments_total: number; daily_limit_remaining: number; sample: string | null; confirmation_token: string;
}

async function plan(tx: Tx, companyId: string, campaignId: string, now: Date) {
  const campaign = await loadCampaign(tx, companyId, campaignId);
  const { candidates, setup, remaining } = await audience(tx, companyId, campaign, now);
  const eligible = candidates.filter(c => !c.reason);
  const count = (reason: string) => candidates.filter(c => c.reason === reason).length;
  const sample = eligible[0] ? renderCampaign(campaign.template.bodyTemplate, { customer_name: eligible[0].name, company_name: setup.companyName }) : null;
  const segments = smsSegments(sample ?? renderCampaign(campaign.template.bodyTemplate, { customer_name: 'Customer', company_name: setup.companyName })).segments;
  const preview: CampaignPreview = {
    matched: candidates.length, eligible: eligible.length, no_marketing_consent: count('no_marketing_consent'),
    missing_phone: count('missing_phone'), invalid_phone: count('invalid_phone'), duplicate_phone: count('duplicate_phone'),
    segments_each: segments, segments_total: segments * eligible.length, daily_limit_remaining: remaining, sample,
    confirmation_token: sha256(JSON.stringify([companyId, campaignId, campaign.template.bodyTemplate, eligible.map(e => `${e.customerId}:${e.phone}`)])),
  };
  return { campaign, candidates, eligible, setup, preview };
}

export async function previewCampaign(tx: Tx, companyId: string, campaignId: string, now = new Date()) {
  return (await plan(tx, companyId, campaignId, now)).preview;
}

// ── send / cancel ───────────────────────────────────────────────────────────

export async function sendCampaign(tx: Tx, companyId: string, campaignId: string, confirmationToken: string, userId: string, now = new Date()) {
  await tx.$queryRaw`SELECT id FROM communication_campaigns WHERE id = ${campaignId} AND company_id = ${companyId} FOR UPDATE`;
  const { campaign, candidates, eligible, setup, preview } = await plan(tx, companyId, campaignId, now);
  if (campaign.status !== 'draft') invalid(`This campaign is ${campaign.status}`, 409);
  if (preview.confirmation_token !== confirmationToken) invalid('The audience changed since the preview; preview again', 409, { preview });
  if (eligible.length === 0) invalid('Nobody in the audience can receive it', 409, { preview });
  if (eligible.length > preview.daily_limit_remaining) invalid(`Only ${preview.daily_limit_remaining} more SMS may be sent today (daily limit)`, 409, { preview });

  const rows = candidates.map(c => ({
    id: randomUUID(), companyId, campaignId, recipientType: 'customer', customerId: c.customerId,
    destination: c.phone ? sha256(c.phone) : `none:${c.customerId}`,
    consentSnapshot: c.reason === 'no_marketing_consent' ? 'not_granted' : 'granted',
    status: c.reason ? 'skipped' : 'queued', skipReason: c.reason,
  }));
  // A duplicate number is skipped, so its hash may repeat: keep destinations unique per campaign.
  for (const row of rows) if (row.status === 'skipped' && row.destination !== `none:${row.customerId}`) row.destination = `skipped:${row.customerId}`;
  await tx.communicationCampaignRecipient.createMany({ data: rows });
  const byCustomer = new Map(rows.map(r => [r.customerId, r.id]));
  await tx.outboundMessage.createMany({ data: eligible.map(e => {
    const text = renderCampaign(campaign.template.bodyTemplate, { customer_name: e.name, company_name: setup.companyName });
    const seg = smsSegments(text);
    return {
      companyId, channel: 'sms', purpose: 'marketing', triggerSource: 'campaign', campaignRecipientId: byCustomer.get(e.customerId)!,
      customerId: e.customerId, templateId: campaign.templateId, createdBy: userId, locale: campaign.locale,
      destinationHash: sha256(e.phone!), destinationEncrypted: encryptString(e.phone!).ciphertext.toString('base64'),
      renderedBody: text, encoding: seg.encoding, segments: seg.segments, status: 'queued',
    };
  }) });
  await tx.communicationCampaign.update({ where: { id: campaignId }, data: { status: 'running', approvedBy: userId, startedAt: now } });
  await tx.auditLog.create({ data: { companyId, userId, correlationId: randomUUID(), action: 'communication_campaign.send',
    entityType: 'communication_campaign', entityId: campaignId, afterValue: JSON.stringify({ ...preview, sample: undefined }) } });
  return { queued: eligible.length, preview };
}

export async function cancelCampaign(tx: Tx, companyId: string, campaignId: string, userId: string, now = new Date()) {
  const campaign = await loadCampaign(tx, companyId, campaignId);
  if (campaign.status !== 'draft' && campaign.status !== 'running') invalid(`This campaign is ${campaign.status}`, 409);
  const moved = await tx.communicationCampaign.updateMany({ where: { id: campaignId, companyId, status: campaign.status },
    data: { status: 'cancelled', cancelledAt: now } });
  if (moved.count !== 1) invalid('The campaign changed; reload', 409);
  const cancelled = await tx.outboundMessage.updateMany({
    where: { companyId, status: 'queued', triggerSource: 'campaign', campaignRecipient: { campaignId } },
    data: { status: 'cancelled', lastErrorCode: 'campaign_cancelled' },
  });
  await tx.auditLog.create({ data: { companyId, userId, correlationId: randomUUID(), action: 'communication_campaign.cancel',
    entityType: 'communication_campaign', entityId: campaignId, beforeValue: JSON.stringify({ status: campaign.status }),
    afterValue: JSON.stringify({ status: 'cancelled', messages_cancelled: cancelled.count }) } });
  return { cancelledMessages: cancelled.count };
}

/** Running campaigns with nothing left to send are completed. */
export async function completeFinishedCampaigns(tx: Tx, companyId: string, now = new Date()) {
  const running = await tx.communicationCampaign.findMany({ where: { companyId, status: 'running' }, select: { id: true } });
  let completed = 0;
  for (const c of running) {
    const pending = await tx.outboundMessage.count({ where: { companyId, triggerSource: 'campaign', status: { in: ['queued', 'sending'] }, campaignRecipient: { campaignId: c.id } } });
    if (pending > 0) continue;
    completed += (await tx.communicationCampaign.updateMany({ where: { id: c.id, companyId, status: 'running' }, data: { status: 'completed', completedAt: now } })).count;
  }
  return completed;
}

// ── read ────────────────────────────────────────────────────────────────────

export async function listCampaigns(tx: Tx, companyId: string) {
  const campaigns = await tx.communicationCampaign.findMany({
    where: { companyId, channel: 'sms', template: { purpose: 'marketing' } },
    include: { template: { select: { bodyTemplate: true } }, creator: { select: { name: true } }, approver: { select: { name: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
  });
  const counts = campaigns.length ? await tx.$queryRaw<Array<{ campaign_id: string; status: string; n: bigint }>>`
    SELECT r.campaign_id, m.status, COUNT(*) AS n
      FROM outbound_messages m JOIN communication_campaign_recipients r ON r.id = m.campaign_recipient_id AND r.company_id = m.company_id
     WHERE m.company_id = ${companyId} AND r.campaign_id IN (${Prisma.join(campaigns.map(c => c.id))})
     GROUP BY r.campaign_id, m.status` : [];
  const skipped = campaigns.length ? await tx.communicationCampaignRecipient.groupBy({
    by: ['campaignId'], where: { companyId, campaignId: { in: campaigns.map(c => c.id) }, status: 'skipped' }, _count: { _all: true },
  }) : [];
  const groups = await tx.customerGroup.findMany({ where: { companyId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  return {
    groups,
    items: campaigns.map(c => {
      const messages: Record<string, number> = {};
      for (const row of counts.filter(r => r.campaign_id === c.id)) messages[row.status] = Number(row.n);
      const definition = JSON.parse(c.audienceDefinition || '{}') as { customer_group_id?: string | null };
      return {
        id: c.id, name: c.name, status: c.status, locale: c.locale, text: c.template.bodyTemplate,
        customer_group: groups.find(g => g.id === definition.customer_group_id) ?? null,
        created_by: c.creator.name, approved_by: c.approver?.name ?? null, created_at: c.createdAt,
        started_at: c.startedAt, completed_at: c.completedAt, cancelled_at: c.cancelledAt,
        messages, skipped: skipped.find(s => s.campaignId === c.id)?._count._all ?? 0,
      };
    }),
  };
}
