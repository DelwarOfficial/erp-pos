// Calendar dates for dues and reminders.
//
// A due date is a calendar date in the company's time zone -- "10 October" --
// not an instant. It is stored in installments.due_date (DATETIME) as that date
// at 00:00:00 UTC, which round-trips exactly and compares as a date. "Today" is
// always the company's local date (companies.timezone, default Asia/Dhaka),
// never the server's: at 23:30 UTC it is already tomorrow in Dhaka.

export type IsoDate = string; // YYYY-MM-DD

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD string as the stored due-date value, rejecting impossible dates. */
export function dateFromIso(value: IsoDate): Date {
  if (!ISO.test(value)) throw new RangeError(`Not a date: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new RangeError(`Not a date: ${value}`);
  return date;
}

export function isoFromDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/** The company's local calendar date at an instant. */
export function localDate(timeZone: string, at: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Minutes after local midnight at an instant, for sending windows. */
export function localMinuteOfDay(timeZone: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const hour = Number(parts.find(p => p.type === 'hour')!.value);
  const minute = Number(parts.find(p => p.type === 'minute')!.value);
  return hour * 60 + minute;
}

/** The instant a local calendar date begins in a time zone. */
export function zonedMidnight(timeZone: string, date: IsoDate): Date {
  // Start from UTC midnight and correct by the zone's offset at that moment;
  // a second pass settles a change of offset (DST) between the two.
  let instant = dateFromIso(date).getTime();
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find(p => p.type === type)!.value);
    const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    instant -= wall - dateFromIso(date).getTime();
  }
  return new Date(instant);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = dateFromIso(date);
  d.setUTCDate(d.getUTCDate() + days);
  return isoFromDate(d);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((dateFromIso(b).getTime() - dateFromIso(a).getTime()) / 86_400_000);
}
