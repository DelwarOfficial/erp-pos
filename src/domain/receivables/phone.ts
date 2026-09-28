// Bangladesh mobile numbers for due reminders.
//
// Canonical form: 8801XXXXXXXXX (13 digits, no plus sign). It is what MiMSMS
// expects in mobileNumber ("international format (e.g. 8801844909020)",
// https://apidoc.mimsms.com), and one form means one destination hash, so
// duplicate suppression and per-customer limits are not defeated by the same
// number written three ways.
//
// Accepted inputs, after removing spaces, dashes, dots and brackets:
//   01XXXXXXXXX       local
//   8801XXXXXXXXX     international without a plus
//   +8801XXXXXXXXX    international
//   008801XXXXXXXXX   international with a 00 prefix
// The digit after 01 must be 3-9 (013-019 are the mobile prefixes in use).
// Anything else is rejected, never guessed: a reminder to a wrong number
// reaches a stranger and discloses a debt.

const MOBILE = /^8801[3-9]\d{8}$/;

export function normalizeBdMobile(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  let digits = input.trim().replace(/[\s\-.()]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('01') && digits.length === 11) digits = `88${digits}`;
  return MOBILE.test(digits) ? digits : null;
}

/** For lists and logs: the operator prefix and the last three digits only. */
export function maskBdMobile(canonical: string): string {
  return canonical.length === 13 ? `${canonical.slice(0, 5)}*****${canonical.slice(-3)}` : '***';
}
