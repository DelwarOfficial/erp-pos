// Due reminder texts.
//
// A reminder's kind follows from its stage: before the due date "upcoming", on
// it "due_today", after it "overdue". Each kind has a built-in Bangla and
// English text; a company can replace one with an active SMS template coded
// `due_reminder.<kind>.<locale>` in communication_templates.
//
// Templates use {{placeholder}} tokens from a fixed list and nothing else:
// no expressions, no code. A template naming an unknown placeholder is refused
// rather than sent with a hole in it.

export type ReminderKind = 'upcoming' | 'due_today' | 'overdue';
export type ReminderLocale = 'bn' | 'en';

export const REMINDER_PLACEHOLDERS = [
  'customer_name', 'company_name', 'invoice_no', 'installment_no',
  'due_amount', 'outstanding_amount', 'due_date', 'days_overdue',
] as const;
export type ReminderValues = Record<(typeof REMINDER_PLACEHOLDERS)[number], string>;

export const DEFAULT_REMINDER_TEMPLATES: Record<ReminderLocale, Record<ReminderKind, string>> = {
  bn: {
    upcoming: 'প্রিয় {{customer_name}}, {{company_name}}: ইনভয়েস {{invoice_no}}-এর কিস্তি {{installment_no}}, ৳{{due_amount}} পরিশোধের তারিখ {{due_date}}। ধন্যবাদ।',
    due_today: 'প্রিয় {{customer_name}}, {{company_name}}: ইনভয়েস {{invoice_no}}-এর কিস্তি {{installment_no}}, ৳{{due_amount}} আজ {{due_date}} পরিশোধযোগ্য। ধন্যবাদ।',
    overdue: 'প্রিয় {{customer_name}}, {{company_name}}: ইনভয়েস {{invoice_no}}-এর কিস্তি {{installment_no}}, ৳{{due_amount}} {{due_date}} তারিখে পরিশোধযোগ্য ছিল ({{days_overdue}} দিন বকেয়া)। অনুগ্রহ করে পরিশোধ করুন।',
  },
  en: {
    upcoming: 'Dear {{customer_name}}, {{company_name}}: instalment {{installment_no}} of invoice {{invoice_no}}, Tk {{due_amount}}, is due on {{due_date}}. Thank you.',
    due_today: 'Dear {{customer_name}}, {{company_name}}: instalment {{installment_no}} of invoice {{invoice_no}}, Tk {{due_amount}}, is due today ({{due_date}}). Thank you.',
    overdue: 'Dear {{customer_name}}, {{company_name}}: instalment {{installment_no}} of invoice {{invoice_no}}, Tk {{due_amount}}, was due on {{due_date}} ({{days_overdue}} days overdue). Please pay.',
  },
};

export function reminderKind(stageOffsetDays: number): ReminderKind {
  return stageOffsetDays < 0 ? 'upcoming' : stageOffsetDays === 0 ? 'due_today' : 'overdue';
}

export function templateCode(kind: ReminderKind, locale: ReminderLocale) {
  return `due_reminder.${kind}.${locale}`;
}

const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** The placeholders a template uses that are not on the list. */
export function unknownPlaceholders(template: string): string[] {
  return [...template.matchAll(TOKEN)].map(m => m[1]).filter(t => !(REMINDER_PLACEHOLDERS as readonly string[]).includes(t));
}

export function renderReminder(template: string, values: ReminderValues): string {
  const unknown = unknownPlaceholders(template);
  if (unknown.length) throw new Error(`Unknown placeholder(s): ${unknown.join(', ')}`);
  return template.replace(TOKEN, (_, name: keyof ReminderValues) => values[name]).trim();
}

/**
 * A Decimal string as taka with Bangladeshi grouping: 150000.5 -> 1,50,000.50.
 * From the string, never through a JavaScript number.
 */
export function formatTaka(amount: string): string {
  const negative = amount.startsWith('-');
  const [whole, fraction = ''] = amount.replace('-', '').split('.');
  const paisa = `${fraction}00`.slice(0, 2);
  let grouped = whole;
  if (whole.length > 3) {
    const head = whole.slice(0, -3);
    grouped = `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}`;
  }
  return `${negative ? '-' : ''}${grouped}.${paisa}`;
}

/** A due date as the customer reads it: 10 অক্টোবর 2026 / 10 Oct 2026. */
export function formatDueDate(isoDate: string, locale: ReminderLocale): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
