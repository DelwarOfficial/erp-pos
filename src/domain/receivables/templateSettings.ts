// Company-editable reminder texts (blueprint §5.11A, Phase 3).
//
// A company overrides a built-in text by saving an active SMS template coded
// `due_reminder.<kind>.<bn|en>` in communication_templates; the reminder
// engine (reminders.ts renderFor) already prefers it. Resetting deactivates
// the override and the built-in text applies again. Texts are plain strings
// with {{placeholder}} tokens from a fixed list -- nothing is evaluated.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';
import {
  DEFAULT_REMINDER_TEMPLATES, REMINDER_PLACEHOLDERS, renderReminder, templateCode, unknownPlaceholders,
  type ReminderKind, type ReminderLocale, type ReminderValues,
} from './reminderTemplates';
import { smsSegments } from './smsSegments';

type Tx = Prisma.TransactionClient;
export const REMINDER_KINDS: ReminderKind[] = ['upcoming', 'due_today', 'overdue'];
export const REMINDER_LOCALES: ReminderLocale[] = ['bn', 'en'];
export const TEMPLATE_MAX_CHARS = 700; // 10 Unicode SMS parts
const LANGUAGE: Record<ReminderLocale, { locale: string; name: string; nativeName: string }> = {
  bn: { locale: 'bn-BD', name: 'Bangla (Bangladesh)', nativeName: 'বাংলা' },
  en: { locale: 'en-BD', name: 'English (Bangladesh)', nativeName: 'English' },
};

const SAMPLE: Record<ReminderLocale, ReminderValues> = {
  bn: { customer_name: 'রহিম উদ্দিন', company_name: 'আপনার দোকান', invoice_no: 'INV-MAIN-000123', installment_no: '2',
    due_amount: '5,000.00', outstanding_amount: '5,000.00', due_date: '15/10/2026', days_overdue: '3' },
  en: { customer_name: 'Rahim Uddin', company_name: 'Your Shop', invoice_no: 'INV-MAIN-000123', installment_no: '2',
    due_amount: '5,000.00', outstanding_amount: '5,000.00', due_date: '15/10/2026', days_overdue: '3' },
};

export function parseTemplateCode(code: string): { kind: ReminderKind; locale: ReminderLocale } {
  for (const kind of REMINDER_KINDS) for (const locale of REMINDER_LOCALES) if (templateCode(kind, locale) === code) return { kind, locale };
  throw new DomainError('RESOURCE_NOT_FOUND', 'Unknown reminder template', { code }, 404);
}

/** The text with sample values, its encoding and SMS parts; refuses unknown placeholders. */
export function previewTemplate(text: string, locale: ReminderLocale) {
  const body = text.trim();
  if (!body) throw new DomainError('VALIDATION_FAILED', 'The text is empty', {}, 400);
  if (body.length > TEMPLATE_MAX_CHARS) throw new DomainError('VALIDATION_FAILED', `At most ${TEMPLATE_MAX_CHARS} characters`, {}, 400);
  const unknown = unknownPlaceholders(body);
  if (unknown.length) {
    throw new DomainError('VALIDATION_FAILED', `Unknown placeholder(s): ${unknown.join(', ')}. Allowed: ${REMINDER_PLACEHOLDERS.join(', ')}`, { unknown }, 400);
  }
  const rendered = renderReminder(body, SAMPLE[locale]);
  return { text: rendered, ...smsSegments(rendered) };
}

export async function listReminderTemplates(tx: Tx, companyId: string) {
  const codes = REMINDER_KINDS.flatMap(kind => REMINDER_LOCALES.map(locale => ({ kind, locale, code: templateCode(kind, locale) })));
  const saved = await tx.communicationTemplate.findMany({
    where: { companyId, code: { in: codes.map(c => c.code) }, channel: 'sms' },
    select: { id: true, code: true, bodyTemplate: true, version: true, isActive: true, createdAt: true },
  });
  return {
    placeholders: REMINDER_PLACEHOLDERS,
    items: codes.map(({ kind, locale, code }) => {
      const custom = saved.find(s => s.code === code) ?? null;
      const active = custom?.isActive ? custom.bodyTemplate : null;
      const effective = active ?? DEFAULT_REMINDER_TEMPLATES[locale][kind];
      return {
        code, kind, locale, default_text: DEFAULT_REMINDER_TEMPLATES[locale][kind],
        custom_text: custom?.bodyTemplate ?? null, custom_active: Boolean(custom?.isActive), version: custom?.version ?? 0,
        effective_text: effective, preview: previewTemplate(effective, locale),
      };
    }),
  };
}

async function audit(tx: Tx, companyId: string, userId: string, action: string, code: string, before: unknown, after: unknown) {
  await tx.auditLog.create({ data: { companyId, userId, correlationId: randomUUID(), action, entityType: 'communication_template', entityId: code,
    beforeValue: before === null ? null : JSON.stringify(before), afterValue: JSON.stringify(after) } });
}

export async function saveReminderTemplate(tx: Tx, companyId: string, code: string, text: string, userId: string) {
  const { locale } = parseTemplateCode(code);
  const preview = previewTemplate(text, locale);
  const language = LANGUAGE[locale];
  const known = await tx.supportedLanguage.findUnique({ where: { locale: language.locale }, select: { locale: true } });
  if (!known) await tx.supportedLanguage.create({ data: { locale: language.locale, name: language.name, nativeName: language.nativeName, isActive: true } });

  const before = await tx.communicationTemplate.findFirst({ where: { companyId, code }, select: { id: true, bodyTemplate: true, version: true, isActive: true } });
  const body = text.trim();
  const saved = before
    ? await tx.communicationTemplate.update({ where: { id: before.id },
      data: { bodyTemplate: body, version: before.version + 1, isActive: true, approvedBy: userId, channel: 'sms', purpose: 'transactional' } })
    : await tx.communicationTemplate.create({ data: {
      companyId, code, channel: 'sms', purpose: 'transactional', locale: language.locale, bodyTemplate: body,
      allowedTokens: JSON.stringify(REMINDER_PLACEHOLDERS), isActive: true, approvedBy: userId,
    } });
  await audit(tx, companyId, userId, 'communication_template.update', code,
    before ? { text: before.bodyTemplate, version: before.version, active: before.isActive } : null, { text: body, version: saved.version });
  return { code, version: saved.version, preview };
}

/** Back to the built-in text. The saved text is kept, inactive, for the record. */
export async function resetReminderTemplate(tx: Tx, companyId: string, code: string, userId: string) {
  parseTemplateCode(code);
  const before = await tx.communicationTemplate.findFirst({ where: { companyId, code }, select: { id: true, isActive: true, version: true } });
  if (!before?.isActive) return { code, reset: false };
  await tx.communicationTemplate.update({ where: { id: before.id }, data: { isActive: false } });
  await audit(tx, companyId, userId, 'communication_template.reset', code, { active: true, version: before.version }, { active: false });
  return { code, reset: true };
}
